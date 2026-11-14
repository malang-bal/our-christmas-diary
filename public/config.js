/* 크리스마스 30문답 공개판 — Firebase 설정값
 *
 * Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱(웹)의 "SDK 설정 및 구성"에서
 * firebaseConfig 값을 그대로 옮겨 적어요. 이 값들은 공개돼도 괜찮은 값이에요
 * (보안은 Firestore·Storage 규칙, App Check, API 키 도메인 제한이 맡아요).
 *
 * dev  = 테스트용 프로젝트, prod = 운영용 프로젝트
 * 사이트 주소를 보고 어느 쪽을 쓸지 자동으로 골라요.
 *   - <프로젝트ID>.web.app / <프로젝트ID>.firebaseapp.com 이면 그 프로젝트
 *   - hosts 에 적은 주소(직접 연결한 도메인)면 그 프로젝트
 *   - 내 컴퓨터(localhost)에서 주소 뒤에 ?emu 를 붙이면 에뮬레이터(가짜 서버)
 */
window.DIARY_ENV = (function () {
  var ENVS = {
    dev: {
      hosts: [],
      appCheckKey: "", // reCAPTCHA v3 사이트 키
      firebase: {
        apiKey: "",
        authDomain: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: ""
      }
    },
    prod: {
      hosts: [], // 예: ["christmas.example.com"]
      appCheckKey: "",
      firebase: {
        apiKey: "",
        authDomain: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: ""
      }
    }
  };

  var h = location.hostname;
  var local = /^(localhost|127\.0\.0\.1)$/.test(h);
  try {
    if (local && /[?&]emu\b/.test(location.search)) sessionStorage.setItem("emu", "1");
    if (local && sessionStorage.getItem("emu") === "1") return { name: "emulator", emulator: true };
  } catch (e) {}

  for (var k in ENVS) {
    var e = ENVS[k], p = e.firebase.projectId;
    if (e.hosts.indexOf(h) >= 0 || (p && (h === p + ".web.app" || h === p + ".firebaseapp.com"))) {
      e.name = k;
      return e;
    }
  }
  ENVS.dev.name = "dev";
  return ENVS.dev;
})();
