// 보안 규칙 테스트 — Firebase 에뮬레이터에서만 돈다 (실제 프로젝트를 건드리지 않는다)
// 실행: npm run test:rules
import { test, before, after, beforeEach, describe } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";

const TS = firebase.firestore.Timestamp;
const FV = firebase.firestore.FieldValue;
const DAY = 864e5;
const INV = "INVITE01", INV2 = "INVITE02", PAIR = "PAIRCD01", RID = "room1";
const A = "alice", B = "bob", C = "carol", ADMIN = "admin";

let env;
const db = (u) => (u ? env.authenticatedContext(u) : env.unauthenticatedContext()).firestore();
const st = (u) => (u ? env.authenticatedContext(u) : env.unauthenticatedContext()).storage();
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const roomData = (owner, invite, pair) => ({
  title: "크리스마스를 기다리는 30문답", sub: "", palette: { bg: "#0f3b2a", main: "#c8352b" },
  paper: "cream", fx: "snow", memberIds: [owner], owner, invite, pairCode: pair,
  pairExp: Date.now() + 7 * DAY, ts: Date.now(),
});
const pairData = (rid, by, ms = 7 * DAY) => ({
  roomId: rid, exp: TS.fromMillis(Date.now() + ms), used: false, createdBy: by,
});

// 가입 코드로 문답을 만드는 묶음(실제 사이트가 보내는 것과 같은 모양)
function signup(u, { rid = RID, invite = INV, pair = PAIR, tweak = () => {} } = {}) {
  const d = db(u), b = d.batch();
  const ops = {
    room: roomData(u, invite, pair),
    invite: { used: true, usedBy: u, usedAt: Date.now(), roomId: rid },
    user: { name: "앨리스", roomId: rid, role: "owner", ts: Date.now() },
    pair: pairData(rid, u),
  };
  tweak(ops);
  if (ops.room) b.set(d.doc("rooms/" + rid), ops.room);
  if (ops.invite) b.update(d.doc("invites/" + invite), ops.invite);
  if (ops.user) b.set(d.doc("users/" + u), ops.user);
  if (ops.pair) b.set(d.doc("pairs/" + pair), ops.pair);
  return b.commit();
}
// 짝꿍 코드로 들어가는 묶음
function join(u, { rid = RID, pair = PAIR, tweak = () => {} } = {}) {
  const d = db(u), b = d.batch();
  const ops = {
    room: { memberIds: FV.arrayUnion(u) },
    pair: { used: true, usedBy: u, usedAt: Date.now() },
    user: { name: "밥", roomId: rid, role: "partner", ts: Date.now() },
  };
  tweak(ops);
  if (ops.room) b.update(d.doc("rooms/" + rid), ops.room);
  if (ops.pair) b.update(d.doc("pairs/" + pair), ops.pair);
  if (ops.user) b.set(d.doc("users/" + u), ops.user);
  return b.commit();
}
const setClose = (ms) => seed((d) => d.doc("meta/config").set({
  start: "2026-11-26", closeAt: TS.fromMillis(Date.now() + ms), deleteOn: "2026-12-31",
}));
// 규칙을 끄고 '두 명이 찬 문답'을 바로 만들어 둔다
const fullRoom = () => seed(async (d) => {
  await d.doc("rooms/" + RID).set({ ...roomData(A, INV, PAIR), memberIds: [A, B] });
  await d.doc("users/" + A).set({ name: "앨리스", roomId: RID, role: "owner", ts: 1 });
  await d.doc("users/" + B).set({ name: "밥", roomId: RID, role: "partner", ts: 1 });
  await d.doc("invites/" + INV).set({ used: true, usedBy: A, roomId: RID, createdAt: 1 });
  await d.doc("pairs/" + PAIR).set({ ...pairData(RID, A), used: true, usedBy: B });
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-christmas",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seed(async (d) => {
    await d.doc("admins/" + ADMIN).set({ on: true });
    await d.doc("invites/" + INV).set({ used: false, createdAt: 1 });
    await d.doc("invites/" + INV2).set({ used: false, createdAt: 2 });
  });
  await setClose(30 * DAY);
});

describe("로그인하지 않은 사람", () => {
  test("아무것도 읽거나 쓸 수 없다", async () => {
    await fullRoom();
    const d = db(null);
    await assertFails(d.doc("rooms/" + RID).get());
    await assertFails(d.doc("invites/" + INV).get());
    await assertFails(d.doc("pairs/" + PAIR).get());
    await assertFails(d.doc("meta/config").get());
    await assertFails(d.collection("rooms/" + RID + "/answers").get());
    await assertFails(d.doc("rooms/x").set({ title: "x" }));
  });
});

describe("관리자·일정·가입 코드", () => {
  test("관리자 표시는 본인 것만 확인하고 아무도 쓸 수 없다", async () => {
    await assertSucceeds(db(ADMIN).doc("admins/" + ADMIN).get());
    await assertSucceeds(db(A).doc("admins/" + A).get());
    await assertFails(db(A).doc("admins/" + ADMIN).get());
    await assertFails(db(A).collection("admins").get());
    await assertFails(db(A).doc("admins/" + A).set({ on: true }));
    await assertFails(db(ADMIN).doc("admins/" + A).set({ on: true }));
  });
  test("일정은 로그인한 사람이 읽고 관리자만 바꾼다", async () => {
    const cfg = { start: "2026-11-26", closeAt: TS.fromMillis(Date.now() + DAY), deleteOn: "2026-12-31" };
    await assertSucceeds(db(A).doc("meta/config").get());
    await assertFails(db(A).doc("meta/config").set(cfg));
    await assertSucceeds(db(ADMIN).doc("meta/config").set(cfg));
    await assertFails(db(ADMIN).doc("meta/config").set({ ...cfg, start: "내일" }));
    await assertFails(db(ADMIN).doc("meta/config").set({ ...cfg, closeAt: 123 }));
  });
  test("가입 코드는 관리자만 발급·목록·삭제한다", async () => {
    await assertSucceeds(db(ADMIN).doc("invites/NEWCODE1").set({ used: false, createdAt: 3 }));
    await assertSucceeds(db(ADMIN).collection("invites").get());
    await assertSucceeds(db(ADMIN).doc("invites/NEWCODE1").delete());
    await assertFails(db(ADMIN).doc("invites/NEWCODE2").set({ used: true, createdAt: 3 }));
    await assertFails(db(A).doc("invites/MYCODE01").set({ used: false, createdAt: 3 }));
    await assertFails(db(A).collection("invites").get());
    await assertFails(db(A).doc("invites/" + INV).delete());
  });
  test("코드를 아는 사람은 그 코드 하나만 확인할 수 있다", async () => {
    await assertSucceeds(db(A).doc("invites/" + INV).get());
  });
  test("사용된 가입 코드는 관리자도 지울 수 없다", async () => {
    await assertSucceeds(signup(A));
    await assertFails(db(ADMIN).doc("invites/" + INV).delete());
  });
});

describe("가입 코드로 문답 만들기", () => {
  test("정상 흐름: 코드 사용 + 문답 + 내 정보 + 짝꿍 코드가 한 번에 만들어진다", async () => {
    await assertSucceeds(signup(A));
    await assertSucceeds(db(A).doc("rooms/" + RID).get());
    await assertSucceeds(db(A).doc("users/" + A).get());
  });
  test("같은 코드는 두 번 쓸 수 없다", async () => {
    await assertSucceeds(signup(A));
    await assertFails(signup(C, { rid: "room2", pair: "PAIRCD02" }));
  });
  test("없는 코드로는 만들 수 없다", async () => {
    await assertFails(signup(A, { invite: "NOPE0000" }));
  });
  test("코드 없이 문답만 만들 수 없다", async () => {
    await assertFails(db(A).doc("rooms/" + RID).set(roomData(A, INV, PAIR)));
    await assertFails(signup(A, { tweak: (o) => { o.invite = null; } }));
  });
  test("문답을 만들지 않고 코드만 '사용됨'으로 바꿀 수 없다", async () => {
    await assertFails(db(A).doc("invites/" + INV).update({ used: true, usedBy: A, usedAt: 1, roomId: RID }));
    await assertFails(signup(A, { tweak: (o) => { o.room = null; o.pair = null; } }));
  });
  test("이미 문답이 있는 사람은 다른 코드를 쓸 수 없다", async () => {
    await assertSucceeds(signup(A));
    await assertFails(signup(A, { rid: "room2", invite: INV2, pair: "PAIRCD02" }));
    await assertFails(signup(A, { rid: "room2", invite: INV2, pair: "PAIRCD02", tweak: (o) => { o.user = null; } }));
  });
  test("내 정보 없이는 만들 수 없다", async () => {
    await assertFails(signup(A, { tweak: (o) => { o.user = null; } }));
  });
  test("처음부터 두 명을 넣거나 남을 주인으로 둘 수 없다", async () => {
    await assertFails(signup(A, { tweak: (o) => { o.room.memberIds = [A, C]; } }));
    await assertFails(signup(A, { tweak: (o) => { o.room.memberIds = [C]; } }));
    await assertFails(signup(A, { tweak: (o) => { o.room.owner = C; } }));
  });
  test("눈 계열이 아닌 효과나 모르는 항목은 넣을 수 없다", async () => {
    await assertFails(signup(A, { tweak: (o) => { o.room.fx = "rain"; } }));
    await assertFails(signup(A, { tweak: (o) => { o.room.closed = false; } }));
    await assertFails(signup(A, { tweak: (o) => { o.room.title = "가".repeat(41); } }));
  });
  test("다른 사람 이름으로 코드를 쓴 것처럼 표시할 수 없다", async () => {
    await assertFails(signup(A, { tweak: (o) => { o.invite.usedBy = C; } }));
  });
  test("짝꿍 코드 만료를 7일보다 길게 잡을 수 없다", async () => {
    await assertFails(signup(A, { tweak: (o) => { o.pair = pairData(RID, A, 30 * DAY); } }));
  });
  test("일정이 없거나 닫힌 뒤에는 가입할 수 없다", async () => {
    await setClose(-1000);
    await assertFails(signup(A));
    await seed((d) => d.doc("meta/config").delete());
    await assertFails(signup(A));
  });
});

describe("짝꿍 코드로 들어가기", () => {
  beforeEach(async () => { await assertSucceeds(signup(A)); });

  test("정상 흐름: 두 번째 멤버가 되고 문답을 읽을 수 있다", async () => {
    await assertFails(db(B).doc("rooms/" + RID).get());
    await assertSucceeds(db(B).doc("pairs/" + PAIR).get());
    await assertSucceeds(join(B));
    const r = await assertSucceeds(db(B).doc("rooms/" + RID).get());
    if (r.data().memberIds.join() !== [A, B].join()) throw new Error("memberIds 가 [A,B] 가 아니다");
  });
  test("2명이 차면 세 번째 사람은 들어올 수 없다", async () => {
    await assertSucceeds(join(B));
    await assertFails(join(C));
    await assertFails(db(C).doc("rooms/" + RID).update({ memberIds: FV.arrayUnion(C) }));
  });
  test("코드를 쓰지 않고 멤버만 될 수 없다", async () => {
    await assertFails(db(B).doc("rooms/" + RID).update({ memberIds: FV.arrayUnion(B) }));
    await assertFails(join(B, { tweak: (o) => { o.pair = null; } }));
  });
  test("들어가지 않고 코드만 써 버릴 수 없다", async () => {
    await assertFails(db(B).doc("pairs/" + PAIR).update({ used: true, usedBy: B, usedAt: 1 }));
    await assertFails(join(B, { tweak: (o) => { o.room = null; o.user = null; } }));
  });
  test("내 정보 없이는 들어갈 수 없다", async () => {
    await assertFails(join(B, { tweak: (o) => { o.user = null; } }));
  });
  test("자기 말고 다른 사람을 넣거나, 기존 멤버를 바꿀 수 없다", async () => {
    await assertFails(join(B, { tweak: (o) => { o.room = { memberIds: [A, C] }; } }));
    await assertFails(join(B, { tweak: (o) => { o.room = { memberIds: [B] }; } }));
    await assertFails(join(B, { tweak: (o) => { o.room = { memberIds: [B, A] }; } }));
    await assertFails(join(B, { tweak: (o) => { o.room = { memberIds: FV.arrayUnion(B), owner: B }; } }));
  });
  test("만료된 짝꿍 코드는 쓸 수 없다", async () => {
    await seed((d) => d.doc("pairs/" + PAIR).update({ exp: TS.fromMillis(Date.now() - 1000) }));
    await assertFails(join(B));
  });
  test("이미 문답이 있는 사람은 다른 문답에 들어갈 수 없다", async () => {
    await assertSucceeds(signup(C, { rid: "room2", invite: INV2, pair: "PAIRCD02" }));
    await assertFails(join(C));
    await assertFails(join(C, { tweak: (o) => { o.user = null; } }));
    // 반대로, 주인이 자기 문답에 또 들어갈 수도 없다
    await assertFails(join(A));
  });
  test("닫힌 뒤에는 들어갈 수 없다", async () => {
    await setClose(-1000);
    await assertFails(join(B));
  });
  test("만료되면 주인이 새 짝꿍 코드를 받을 수 있고, 옛 코드는 못 쓴다", async () => {
    const d = db(A), b = d.batch(), exp = Date.now() + 7 * DAY;
    b.set(d.doc("pairs/NEWPAIR1"), pairData(RID, A));
    b.update(d.doc("rooms/" + RID), { pairCode: "NEWPAIR1", pairExp: exp });
    await assertSucceeds(b.commit());
    await assertFails(join(B));
    await assertSucceeds(join(B, { pair: "NEWPAIR1" }));
  });
  test("남의 문답에 짝꿍 코드를 만들 수 없다", async () => {
    await assertFails(db(C).doc("pairs/EVILPAIR").set(pairData(RID, C)));
    const d = db(C), b = d.batch();
    b.set(d.doc("pairs/EVILPAIR"), pairData(RID, C));
    b.update(d.doc("rooms/" + RID), { pairCode: "EVILPAIR", pairExp: 1 });
    await assertFails(b.commit());
  });
  test("2명이 찬 뒤에는 짝꿍 코드를 새로 만들 수 없다", async () => {
    await assertSucceeds(join(B));
    const d = db(A), b = d.batch();
    b.set(d.doc("pairs/NEWPAIR1"), pairData(RID, A));
    b.update(d.doc("rooms/" + RID), { pairCode: "NEWPAIR1", pairExp: 1 });
    await assertFails(b.commit());
  });
  test("짝꿍 코드 문서 없이 문답의 짝꿍 코드만 바꿀 수 없다", async () => {
    await assertFails(db(A).doc("rooms/" + RID).update({ pairCode: "GHOST001", pairExp: 1 }));
  });
});

describe("문답은 멤버 두 명만", () => {
  beforeEach(async () => {
    await fullRoom();
    await seed(async (d) => {
      const p = "rooms/" + RID + "/";
      await d.doc(p + "members/" + A).set({ name: "앨리스", color: "#c8352b", img: "" });
      await d.doc(p + "answers/" + A).set({ a: { 1: "비밀 답변" } });
      await d.doc(p + "says/s1").set({ uid: A, text: "안녕", ts: 1 });
      await d.doc(p + "stamps/d1_" + A).set({ day: 1, uid: A, img: "https://x/y", ts: 1 });
      await d.doc(p + "headers/h1").set({ aid: "https://x/h", y: 50, by: A, ts: 1 });
      await d.doc(p + "chats/d1/messages/m1").set({ uid: A, text: "채팅", ts: 1 });
    });
  });
  const p = "rooms/" + RID + "/";

  test("다른 사람은 문답과 그 안의 어떤 기록도 읽을 수 없다", async () => {
    const d = db(C);
    await assertFails(d.doc("rooms/" + RID).get());
    for (const c of ["members", "answers", "says", "stamps", "headers", "chats/d1/messages"]) {
      await assertFails(d.collection(p + c).get());
    }
    await assertFails(d.doc(p + "answers/" + A).get());
    await assertFails(d.doc(p + "chats/d1/messages/m1").get());
    await assertFails(d.collectionGroup("messages").get());
  });
  test("다른 사람은 문답 안에 아무것도 쓸 수 없다", async () => {
    const d = db(C);
    await assertFails(d.doc(p + "answers/" + C).set({ a: { 1: "끼어들기" } }));
    await assertFails(d.collection(p + "says").add({ uid: C, text: "끼어들기", ts: 1 }));
    await assertFails(d.collection(p + "chats/d1/messages").add({ uid: C, text: "끼어들기", ts: 1 }));
    await assertFails(d.doc(p + "members/" + C).set({ name: "캐럴", color: "#000000", img: "" }));
    await assertFails(d.doc(p + "headers/h2").set({ aid: "https://x/h", y: 50, by: C, ts: 1 }));
    await assertFails(d.doc("rooms/" + RID).update({ title: "뺏기" }));
  });
  test("누구도 전체 문답 목록을 볼 수 없다", async () => {
    await assertFails(db(A).collection("rooms").get());
    await assertFails(db(ADMIN).collection("rooms").get());
    await assertFails(db(A).collection("rooms").where("memberIds", "array-contains", A).get());
    await assertFails(db(A).collection("users").get());
    await assertFails(db(A).collection("pairs").get());
  });
  test("관리자도 남의 문답은 읽을 수 없다", async () => {
    await assertFails(db(ADMIN).doc("rooms/" + RID).get());
    await assertFails(db(ADMIN).collection(p + "answers").get());
  });
  test("멤버 두 명은 모든 기록을 읽을 수 있다", async () => {
    for (const u of [A, B]) {
      const d = db(u);
      await assertSucceeds(d.doc("rooms/" + RID).get());
      for (const c of ["members", "answers", "says", "stamps", "headers", "chats/d1/messages"]) {
        await assertSucceeds(d.collection(p + c).get());
      }
    }
  });
  test("답변과 프로필은 본인 것만 쓴다", async () => {
    await assertSucceeds(db(B).doc(p + "answers/" + B).set({ a: { 1: "내 답변" } }));
    await assertFails(db(B).doc(p + "answers/" + A).set({ a: { 1: "바꿔치기" } }));
    await assertFails(db(B).doc(p + "answers/" + A).delete());
    await assertSucceeds(db(B).doc(p + "members/" + B).set({ name: "밥", color: "#2f6b4f", img: "" }));
    await assertFails(db(B).doc(p + "members/" + A).set({ name: "가짜", color: "#2f6b4f", img: "" }));
    await assertFails(db(B).doc(p + "members/" + B).set({ name: "밥", color: "#2f6b4f", img: "x".repeat(601) }));
    await assertFails(db(B).doc(p + "members/" + B).set({ name: "가".repeat(13), color: "#2f6b4f", img: "" }));
  });
  test("한마디는 본인 이름으로만 쓰고 본인 것만 지운다", async () => {
    await assertSucceeds(db(B).collection(p + "says").add({ uid: B, text: "보고 싶다", ts: 2 }));
    await assertFails(db(B).collection(p + "says").add({ uid: A, text: "사칭", ts: 2 }));
    await assertFails(db(B).collection(p + "says").add({ uid: B, text: "가".repeat(201), ts: 2 }));
    await assertFails(db(B).doc(p + "says/s1").delete());
    await assertFails(db(A).doc(p + "says/s1").update({ text: "수정" }));
    await assertSucceeds(db(A).doc(p + "says/s1").delete());
  });
  test("채팅은 본인 이름으로만, 1~30일 방에만, 고치거나 지울 수 없다", async () => {
    const c = db(B).collection(p + "chats/d1/messages");
    await assertSucceeds(c.add({ uid: B, text: "안녕", ts: 2 }));
    await assertSucceeds(c.add({ uid: B, dice: 6, v: 3, ts: 3 }));
    await assertSucceeds(db(B).collection(p + "chats/d30/messages").add({ uid: B, text: "마지막 날", ts: 2 }));
    await assertFails(c.add({ uid: A, text: "사칭", ts: 2 }));
    await assertFails(c.add({ uid: B, text: "가".repeat(501), ts: 2 }));
    await assertFails(c.add({ uid: B, dice: 6, v: 7, ts: 3 }));
    await assertFails(c.add({ uid: B, dice: 1000, v: 999, ts: 3 }));
    await assertFails(c.add({ uid: B, text: "덤", extra: 1, ts: 2 }));
    await assertFails(db(B).collection(p + "chats/d31/messages").add({ uid: B, text: "없는 날", ts: 2 }));
    await assertFails(db(B).collection(p + "chats/d0/messages").add({ uid: B, text: "없는 날", ts: 2 }));
    await assertFails(db(A).doc(p + "chats/d1/messages/m1").update({ text: "수정" }));
    await assertFails(db(A).doc(p + "chats/d1/messages/m1").delete());
  });
  test("우표는 정해진 이름으로 한 번만 붙이고 바꿀 수 없다", async () => {
    const ok = { day: 2, uid: B, img: "https://x/y", ts: 1 };
    await assertSucceeds(db(B).doc(p + "stamps/d2_" + B).set(ok));
    await assertFails(db(B).doc(p + "stamps/d2_" + B).set({ ...ok, img: "https://x/z" }));
    await assertFails(db(B).doc(p + "stamps/d2_" + B).delete());
    await assertFails(db(B).doc(p + "stamps/d3_" + A).set({ ...ok, day: 3 }));
    await assertFails(db(B).doc(p + "stamps/d3_" + B).set({ ...ok, day: 3, uid: A }));
    await assertFails(db(B).doc(p + "stamps/d4_" + B).set({ ...ok, day: 3 }));
    await assertFails(db(B).doc(p + "stamps/d31_" + B).set({ ...ok, day: 31 }));
  });
  test("헤더는 h1~h4 네 칸뿐이다", async () => {
    const h = { aid: "https://x/h", y: 50, by: B, ts: 1 };
    for (const k of ["h2", "h3", "h4"]) await assertSucceeds(db(B).doc(p + "headers/" + k).set(h));
    await assertFails(db(B).doc(p + "headers/h5").set(h));
    await assertFails(db(B).doc(p + "headers/extra").set(h));
    await assertFails(db(B).collection(p + "headers").add(h));
    await assertSucceeds(db(B).doc(p + "headers/h1").delete());
  });
  test("문답 설정은 제목·색·종이·효과만 바꿀 수 있다", async () => {
    const r = db(B).doc("rooms/" + RID);
    await assertSucceeds(r.update({ title: "우리의 겨울", palette: { bg: "#111111", main: "#eeeeee" }, paper: "navy", fx: "bigsnow" }));
    await assertFails(r.update({ fx: "rain" }));
    await assertFails(r.update({ title: "" }));
    await assertFails(r.update({ memberIds: [B] }));
    await assertFails(r.update({ memberIds: [A, B, C] }));
    await assertFails(r.update({ owner: B }));
    await assertFails(r.update({ invite: INV2 }));
    await assertFails(r.update({ closed: true }));
    await assertFails(r.delete());
  });
  test("내 정보는 이름만 바꿀 수 있고 문답을 옮길 수 없다", async () => {
    await assertSucceeds(db(B).doc("users/" + B).update({ name: "바비" }));
    await assertFails(db(B).doc("users/" + B).update({ roomId: "room2" }));
    await assertFails(db(B).doc("users/" + B).update({ role: "owner" }));
    await assertFails(db(B).doc("users/" + B).delete());
    await assertFails(db(B).doc("users/" + A).get());
    await assertFails(db(C).doc("users/" + C).set({ name: "캐럴", roomId: RID, role: "partner", ts: 1 }));
  });
  test("모르는 경로에는 아무것도 쓸 수 없다", async () => {
    await assertFails(db(A).doc("emotes/e1").set({ data: "x" }));
    await assertFails(db(A).doc("hlib/h1").set({ aid: "x" }));
    await assertFails(db(A).doc(p + "secret/x").set({ a: 1 }));
  });

  describe("문답이 닫힌 뒤", () => {
    beforeEach(async () => { await setClose(-1000); });
    test("읽기는 되고 쓰기는 모두 막힌다", async () => {
      const d = db(A);
      await assertSucceeds(d.doc("rooms/" + RID).get());
      await assertSucceeds(d.collection(p + "answers").get());
      await assertSucceeds(d.collection(p + "chats/d1/messages").get());
      await assertFails(d.doc(p + "answers/" + A).set({ a: { 1: "늦은 답변" } }));
      await assertFails(d.collection(p + "says").add({ uid: A, text: "늦은 한마디", ts: 9 }));
      await assertFails(d.doc(p + "says/s1").delete());
      await assertFails(d.collection(p + "chats/d30/messages").add({ uid: A, text: "늦은 채팅", ts: 9 }));
      await assertFails(d.doc(p + "members/" + A).set({ name: "앨리스", color: "#000000", img: "" }));
      await assertFails(d.doc(p + "headers/h2").set({ aid: "https://x/h", y: 50, by: A, ts: 1 }));
      await assertFails(d.doc(p + "headers/h1").delete());
      await assertFails(d.doc(p + "stamps/d5_" + A).set({ day: 5, uid: A, img: "https://x/y", ts: 1 }));
      await assertFails(d.doc("rooms/" + RID).update({ title: "늦은 수정" }));
    });
  });
});

describe("이미지 저장소(Storage)", () => {
  const JPG = { contentType: "image/jpeg" };
  let n = 0;
  beforeEach(() => { n++; });
  // 테스트마다 파일 이름이 겹치지 않게(에뮬레이터가 파일을 바로 지우지 않을 수 있어서)
  const f = (u, path) => st(u).ref(path.replace(/(\.[a-z]+)$/, "-t" + n + "$1"));
  beforeEach(async () => { await fullRoom(); });

  test("멤버는 자기 문답 폴더에 이미지를 올리고 읽을 수 있다", async () => {
    await assertSucceeds(f(A, "rooms/" + RID + "/headers/h1-1.jpg").putString("img", "raw", JPG));
    await assertSucceeds(f(B, "rooms/" + RID + "/headers/h1-1.jpg").getDownloadURL());
    await assertSucceeds(f(B, "rooms/" + RID + "/stamps/d1_bob-1.webp").putString("img", "raw", { contentType: "image/webp" }));
    await assertSucceeds(f(B, "rooms/" + RID + "/profiles/bob-1.jpg").putString("img", "raw", JPG));
  });
  test("다른 사람은 올릴 수도 읽을 수도 지울 수도 없다", async () => {
    await assertSucceeds(f(A, "rooms/" + RID + "/headers/h1-1.jpg").putString("img", "raw", JPG));
    await assertFails(f(C, "rooms/" + RID + "/headers/h1-1.jpg").getDownloadURL());
    await assertFails(f(C, "rooms/" + RID + "/headers/h2-1.jpg").putString("img", "raw", JPG));
    await assertFails(f(C, "rooms/" + RID + "/headers/h1-1.jpg").delete());
    await assertFails(f(null, "rooms/" + RID + "/headers/h1-1.jpg").getDownloadURL());
    await assertFails(st(C).ref("rooms/" + RID + "/headers").listAll());
    await assertFails(st(A).ref("rooms/" + RID + "/headers").listAll());
  });
  test("이미지가 아니거나 1MB 이상이면 올릴 수 없다", async () => {
    await assertFails(f(A, "rooms/" + RID + "/headers/a.html").putString("<script>", "raw", { contentType: "text/html" }));
    await assertFails(f(A, "rooms/" + RID + "/headers/a.svg").putString("<svg/>", "raw", { contentType: "image/svg+xml" }));
    await assertFails(f(A, "rooms/" + RID + "/headers/big.jpg").put(new Uint8Array(1024 * 1024 + 10), JPG));
  });
  test("정해진 폴더 밖에는 올릴 수 없다", async () => {
    await assertFails(f(A, "rooms/" + RID + "/etc/a.jpg").putString("img", "raw", JPG));
    await assertFails(f(A, "rooms/" + RID + "/a.jpg").putString("img", "raw", JPG));
    await assertFails(f(A, "public/a.jpg").putString("img", "raw", JPG));
    await assertFails(f(A, "rooms/room2/headers/a.jpg").putString("img", "raw", JPG));
  });
  test("덮어쓸 수 없고, 헤더·프로필만 지울 수 있다", async () => {
    await assertSucceeds(f(A, "rooms/" + RID + "/headers/h1-1.jpg").putString("img", "raw", JPG));
    await assertFails(f(B, "rooms/" + RID + "/headers/h1-1.jpg").putString("img2", "raw", JPG));
    await assertSucceeds(f(B, "rooms/" + RID + "/headers/h1-1.jpg").delete());
    await assertSucceeds(f(A, "rooms/" + RID + "/stamps/d1_alice-1.png").putString("img", "raw", { contentType: "image/png" }));
    await assertFails(f(A, "rooms/" + RID + "/stamps/d1_alice-1.png").delete());
  });
  test("닫힌 뒤에는 읽기만 된다", async () => {
    await assertSucceeds(f(A, "rooms/" + RID + "/headers/h1-1.jpg").putString("img", "raw", JPG));
    await setClose(-1000);
    await assertSucceeds(f(B, "rooms/" + RID + "/headers/h1-1.jpg").getDownloadURL());
    await assertFails(f(A, "rooms/" + RID + "/headers/h2-1.jpg").putString("img", "raw", JPG));
    await assertFails(f(A, "rooms/" + RID + "/headers/h1-1.jpg").delete());
  });
});
