// 임시 점검 도구(읽기 전용): 운영 데이터 형식 · App Check 강제 여부 · 배포된 규칙 확인
// 내용은 출력하지 않고 개수와 형식 위반 여부만 출력한다. 사용 후 저장소에서 지운다.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const PROJECT = process.argv[2] || "our-christmas-diary-prod";
const TOKEN = execSync("gcloud auth print-access-token").toString().trim();
const H = { Authorization: "Bearer " + TOKEN, "x-goog-user-project": PROJECT };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const j = async u => { const r = await fetch(u, { headers: H }); const t = await r.text(); return { ok: r.ok, status: r.status, body: t ? JSON.parse(t) : {} }; };
async function list(path) { const out = []; let tok = ""; do { const r = await j(BASE + path + "?pageSize=300" + (tok ? "&pageToken=" + tok : "")); (r.body.documents || []).forEach(d => out.push(d)); tok = r.body.nextPageToken || ""; } while (tok); return out; }
const F = d => d.fields || {};
const sv = v => v && (v.stringValue ?? v.integerValue ?? v.doubleValue);
const HEX = /^#[0-9a-fA-F]{6}$/, URL = /^https:\/\/firebasestorage\.googleapis\.com\/[A-Za-z0-9._~%\/?&=+-]*$/;
const PAPERS = ["cream","sand","peach","rose","mint","sage","sky","lilac","white","warmgray","coolgray","ash","mocha","wine","forest","navy","terra","teal","ink","charcoal","slate"];
const bad = [];
const rooms = await list("/rooms");
let nMem = 0, nHead = 0, nStamp = 0, nChat = 0, nSay = 0, nAns = 0;
for (const r of rooms) {
  const id = r.name.split("/").pop(), f = F(r), R = "/rooms/" + id;
  const pal = f.palette?.mapValue?.fields || {}, pk = Object.keys(pal);
  if (!pk.every(k => ["bg", "main"].includes(k)) || !pk.every(k => HEX.test(sv(pal[k]) || ""))) bad.push(id + " palette keys=" + pk.join(","));
  if (!PAPERS.includes(sv(f.paper))) bad.push(id + " paper");
  const mids = (f.memberIds?.arrayValue?.values || []).map(sv);
  if (mids.length > 2) bad.push(id + " members>2");
  for (const m of await list(R + "/members")) { nMem++; const g = F(m); if (!HEX.test(sv(g.color) || "")) bad.push(id + " member color"); const im = sv(g.img) || ""; if (im && !URL.test(im)) bad.push(id + " member img"); if (!mids.includes(m.name.split("/").pop())) bad.push(id + " member not in memberIds"); }
  for (const h of await list(R + "/headers")) { nHead++; const g = F(h); if (!URL.test(sv(g.aid) || "")) bad.push(id + " header aid"); if (!("integerValue" in (g.y || {}) || "doubleValue" in (g.y || {}))) bad.push(id + " header y"); }
  for (const s of await list(R + "/stamps")) { nStamp++; if (!URL.test(sv(F(s).img) || "")) bad.push(id + " stamp img"); }
  nSay += (await list(R + "/says")).length;
  nAns += (await list(R + "/answers")).length;
  for (let d = 1; d <= 30; d++) nChat += (await list(R + "/chats/d" + d + "/messages")).length;
}
const users = await list("/users"), inv = await list("/invites"), pairs = await list("/pairs");
const usedInv = inv.filter(d => F(d).used?.booleanValue).length;
// 사용자 → 방 연결이 실제 방 멤버와 맞는지
const roomMembers = Object.fromEntries(rooms.map(r => [r.name.split("/").pop(), (F(r).memberIds?.arrayValue?.values || []).map(sv)]));
for (const u of users) { const uid = u.name.split("/").pop(), rid = sv(F(u).roomId); if (!roomMembers[rid] || !roomMembers[rid].includes(uid)) bad.push("user " + uid.slice(0, 6) + "… roomId mismatch"); }
console.log(JSON.stringify({ rooms: rooms.length, users: users.length, members: nMem, answers: nAns, chats: nChat, says: nSay, headers: nHead, stamps: nStamp, invites: inv.length, invitesUsed: usedInv, pairs: pairs.length }));
console.log("형식 위반:", bad.length ? bad : "없음");
// App Check 강제 여부
const num = JSON.parse(execSync(`gcloud projects describe ${PROJECT} --format=json`).toString()).projectNumber;
for (const svc of ["firestore.googleapis.com", "firebasestorage.googleapis.com", "identitytoolkit.googleapis.com"]) {
  const r = await j(`https://firebaseappcheck.googleapis.com/v1/projects/${num}/services/${svc}`);
  console.log("AppCheck", svc, r.ok ? (r.body.enforcementMode || "OFF") : r.status);
}
// 배포된 규칙이 저장소와 같은지
for (const [rel, file] of [["cloud.firestore", "firestore.rules"], [null, "storage.rules"]]) {
  const rels = await j(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases?pageSize=50`);
  const want = rel ? (rels.body.releases || []).find(x => x.name.endsWith("/" + rel)) : (rels.body.releases || []).find(x => x.name.includes("firebase.storage"));
  if (!want) { console.log("rules release 없음", file); continue; }
  const rs = await j(`https://firebaserules.googleapis.com/v1/${want.rulesetName}`);
  const src = rs.body.source?.files?.[0]?.content || "";
  console.log("배포된 규칙 = 저장소", file, src.trim() === readFileSync(file, "utf8").trim());
}
