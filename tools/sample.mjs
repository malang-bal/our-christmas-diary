// 임시 도구: 시험 코드 방에 샘플 기록 넣기 / 일정 당기기 / 되돌리기
// 사용: node tools/sample.mjs <inspect|apply|restore> <CODE>
// Cloud Shell(프로젝트 소유자 계정)에서만 실행. 끝나면 저장소에서 지운다.
import { execSync } from "node:child_process";
const PROJECT = "our-christmas-diary-prod";
const [, , cmd = "inspect", CODE = "39UPYBDK"] = process.argv;
const TOKEN = execSync("gcloud auth print-access-token").toString().trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", "x-goog-user-project": PROJECT };
const BOT = "sample-partner";
const SAMPLE_START = "2026-10-21"; // 오늘(11/16)이 27일째
const REAL_START = "2026-11-26";

const enc = v => v === null ? { nullValue: null }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : v instanceof Date ? { timestampValue: v.toISOString() }
  : typeof v === "string" ? { stringValue: v }
  : typeof v === "boolean" ? { booleanValue: v }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
const dec = v => !v ? undefined : "stringValue" in v ? v.stringValue : "integerValue" in v ? +v.integerValue
  : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue : "timestampValue" in v ? v.timestampValue
  : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(dec)
  : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : v;
const fields = o => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, enc(x)]));
async function req(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) { if (r.status === 404) return null; throw new Error(method + " " + path + " → " + r.status + " " + t.slice(0, 300)); }
  return t ? JSON.parse(t) : {};
}
const get = async p => { const d = await req("GET", p); return d && d.fields ? Object.fromEntries(Object.entries(d.fields).map(([k, x]) => [k, dec(x)])) : null; };
const patch = (p, o, mask) => req("PATCH", p + (mask ? "?" + mask.map(m => "updateMask.fieldPaths=" + m).join("&") : ""), { fields: fields(o) });
async function listIds(p) { const out = []; let tok = ""; do { const d = await req("GET", p + "?pageSize=300&mask.fieldPaths=__name__" + (tok ? "&pageToken=" + tok : "")); (d?.documents || []).forEach(x => out.push(x.name.split("/").pop())); tok = d?.nextPageToken || ""; } while (tok); return out; }

const inv = await get("/invites/" + CODE);
const conf = await get("/meta/config");
console.log("일정:", JSON.stringify(conf));
if (!inv) { console.log("코드 없음"); process.exit(1); }
console.log("코드:", JSON.stringify({ used: inv.used, roomId: inv.roomId || null }));
const rooms = await listIds("/rooms");
console.log("전체 방 수:", rooms.length);
if (cmd === "inspect") process.exit(0);

if (cmd === "restore") {
  const RID = inv.roomId, R = "/rooms/" + RID;
  let del = 0;
  for (let day = 1; day <= 30; day++) {
    const col = R + "/chats/d" + day + "/messages";
    for (const id of await listIds(col)) if (id.startsWith("sample-")) { await req("DELETE", col + "/" + id); del++; }
  }
  for (const id of await listIds(R + "/says")) if (id.startsWith("sample-")) { await req("DELETE", R + "/says/" + id); del++; }
  globalThis.__RESTORE = { R, del };
}
if (cmd !== "apply" && cmd !== "restore") { console.log("모르는 명령"); process.exit(1); }
if (!inv.used || !inv.roomId) { console.log("아직 아무도 이 코드로 가입하지 않았어요. 먼저 가입이 필요해요."); process.exit(1); }
const RID = inv.roomId, R = "/rooms/" + RID;
const room = await get(R);
const ME = room.owner;
const ids = room.memberIds || [];
let PT = ids.find(x => x !== ME);
if (!PT) { PT = BOT; await patch(R, { memberIds: [ME, BOT] }, ["memberIds"]); }
if (!(await get(R + "/members/" + PT))) await patch(R + "/members/" + PT, { name: "루돌프", color: "#c8553d", img: "" });
if (!(await get(R + "/members/" + ME))) await patch(R + "/members/" + ME, { name: "나", color: "#2f6b4f", img: "" });

const [y, m, d] = SAMPLE_START.split("-").map(Number);
const at = (day, h, mi) => new Date(Date.UTC(y, m - 1, d + day - 1, h - 9, mi)); // KST
const LAST = 26; // 지난 날 1~26일 채움, 27일(오늘)은 나만 미리 씀

const A_ME = ["설렘 반 걱정 반! 30일 동안 하루도 안 빠지고 써 볼게.", "일 년 중 제일 반짝이는 날. 거리 분위기만으로도 기분이 좋아져.", "작년엔 둘 다 감기 걸려서 집에서 귤만 까먹었지 ㅋㅋ", "따뜻한 목도리! 아니면 필름 카메라.", "직접 뜬 장갑을 주고 싶은데… 완성할 수 있을까?", "딸기 듬뿍 올라간 생크림 케이크.", "직접 굽기! 망해도 그게 추억이니까.", "어릴 때 트리 밑에서 자다가 산타 기다린 날.", "화이트 크리스마스. 눈 오는 날은 다 용서돼.", "엄청 좋아해. 전구 감는 게 제일 재밌어.", "작은 오두막에 벽난로 있는 곳.", "와인 한 잔 정도는 괜찮지 않을까?", "뱅쇼! 시나몬 향 나는 거.", "창문에 눈꽃 스티커 붙이기.", "11월 중순이면 이미 늦은 편 아냐?", "초등학교 3학년까지 믿었어.", "몇 명한테만 손으로 꼭 써.", "생일 다음으로 2위!", "당연하지. 제일 큰 양말로.", "솔잎이랑 오렌지 껍질 향.", "빨강이랑 초록, 그리고 금색 조금.", "눈 쌓인 골목에 노란 가로등.", "둘이 트리 앞에서 찍은 흔들린 사진.", "같이 있으면 평범한 날도 특별해지니까.", "120퍼센트!", "아니, 자정까지 버틸 거야.", "같이 케이크 만들고 영화 보기.", "내년에도 이렇게 웃게 해 주세요."];
const A_PT = ["일단 매일 쓰는 게 목표. 빼먹으면 혼내 줘.", "솔직히 예전엔 그냥 쉬는 날이었는데 요즘은 기다려져.", "귤 한 박스 다 먹은 거 아직도 기억나.", "네가 골라 준 거면 뭐든.", "비밀. 근데 분명 좋아할 거야.", "초코 케이크! 생크림은 네가 먹어.", "구매. 대신 제일 맛있는 집으로.", "가족이랑 눈썰매장 갔다가 넘어져서 운 날.", "그린 크리스마스. 추운 거 싫어…", "보는 건 좋은데 치우는 건 싫어.", "사람 없는 바닷가도 좋을 것 같아.", "맨정신! 기억하고 싶으니까.", "핫초코에 마시멜로.", "조명을 전부 따뜻한 색으로 바꾸기.", "12월 1일부터가 국룰.", "산타는 지금도 믿어.", "한 번도 안 써 봤는데 올해는 써 볼게.", "1위. 이유는 너.", "걸어 두면 뭐 넣어 줄 거야?", "갓 구운 빵 냄새.", "하얀색.", "창밖으로 보이는 트리 불빛.", "네가 웃고 있는 사진 한 장.", "이유가 꼭 필요해? 그냥 너니까.", "기대 안 하려고 했는데 이미 100.", "너 따라 자정까지."];
const A_ME_TODAY = "같이 케이크 만들기! 반죽은 내가 할게.";

if (cmd === "restore") {
  for (const [who, list, extra] of [[ME, A_ME, { [LAST + 1]: A_ME_TODAY }], [PT, A_PT, {}]]) {
    const cur = await get(R + "/answers/" + who); if (!cur) continue;
    const a = { ...(cur.a || {}) }, r = { ...(cur.r || {}) }, S = { ...Object.fromEntries(list.map((t, i) => [i + 1, t])), ...extra };
    let n = 0; for (const k of Object.keys(a)) if (a[k] === S[k]) { delete a[k]; n++; }
    if (who === PT && r[26] === at(26, 23, 41).getTime()) delete r[26];
    await patch(R + "/answers/" + who, { a, r }); console.log("답변 정리", who, n + "칸 삭제, 남은 칸", Object.keys(a).length);
  }
  await patch("/meta/config", { start: REAL_START }, ["start"]);
  console.log(JSON.stringify({ deleted: globalThis.__RESTORE.del, start: REAL_START })); process.exit(0);
}
const ans = await get(R + "/answers/" + ME);
const mine = { ...(ans?.a || {}) };
A_ME.slice(0, LAST).forEach((t, i) => { if (!mine[i + 1]) mine[i + 1] = t; });
if (!mine[LAST + 1]) mine[LAST + 1] = A_ME_TODAY;
await patch(R + "/answers/" + ME, { a: mine, r: ans?.r || {} });
const pa = await get(R + "/answers/" + PT);
const theirs = { ...(pa?.a || {}) };
A_PT.slice(0, LAST).forEach((t, i) => { if (!theirs[i + 1]) theirs[i + 1] = t; });
await patch(R + "/answers/" + PT, { a: theirs, r: { 26: at(26, 23, 41).getTime() } });

// 채팅: 날마다 몇 마디
const TALK = [
  ["오늘부터 시작이다!", "!조금 떨린다", "매일 저녁 9시에 쓰자", "#약속"],
  ["너 크리스마스 이렇게 좋아하는 줄 몰랐어", "숨겨 왔지 ㅋㅋ"],
  ["귤 얘기 왜 해 ㅋㅋㅋ", "올해는 두 박스 사자"],
  ["목도리 색 뭐가 좋아?", "초록!", "[d6] 굴려서 정하자"],
  ["장갑 진도 어때?", "!엄지까지 떴어…"],
  ["초코 vs 딸기 결판 내자", "#반반 케이크로 합의"],
  ["굽기 하면 오븐 빌려야 해", "우리 집 거 쓰자"],
];
const daysWithChat = [1, 2, 3, 4, 5, 6, 7, 9, 12, 13, 15, 18, 20, 22, 24, 25, 26, 27];
const GEN = [["오늘 질문 좋다", "그치? 생각 많이 했어"], ["답 보고 웃었잖아", "웃으라고 쓴 거야 ㅋㅋ"], ["!졸려…", "얼른 자", "#잘 자"], ["[d100] 오늘 운세", "높다! 좋은 날"]];
let nMsg = 0;
for (const day of daysWithChat) {
  const col = R + "/chats/d" + day + "/messages";
  const existing = await listIds(col);
  if (existing.some(x => x.startsWith("sample-"))) continue;
  const lines = TALK[day - 1] || GEN[day % GEN.length];
  for (let i = 0; i < lines.length; i++) {
    const who = i % 2 === 0 ? ME : PT, t = at(day, 21, 3 + i * 2), ts = t.getTime();
    const doc = { uid: who, text: lines[i], ts, st: t };
    await req("PATCH", col + "/sample-" + day + "-" + i, { fields: fields(doc) });
    nMsg++;
    const dm = lines[i].match(/\[d(100|10|6)\]/i);
    if (dm) { const n = +dm[1]; await req("PATCH", col + "/sample-" + day + "-" + i + "-dice", { fields: fields({ uid: who, dice: n, v: 1 + Math.floor(Math.random() * n), ts: ts + 1, st: new Date(ts + 1) }) }); nMsg++; }
  }
}
// 한마디
const SAYS = [[ME, "오늘 첫눈 왔대!"], [PT, "케이크 예약 완료 🎂"], [ME, "트리 전구 샀다"], [PT, "벌써 27일째라니"]];
for (let i = 0; i < SAYS.length; i++) {
  const ts = Date.now() - (SAYS.length - i) * 3600e3 * 7;
  await patch(R + "/says/sample-" + i, { uid: SAYS[i][0], text: SAYS[i][1], ts });
}
await patch("/meta/config", { start: SAMPLE_START }, ["start"]);
console.log(JSON.stringify({ room: RID, me: ME, partner: PT, chats: nMsg, says: SAYS.length, start: SAMPLE_START }));
