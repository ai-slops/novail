import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/domain/canonical.mjs";
import { initializeBranches } from "./branch-state.mjs";

const sceneSeven = [
  "봉쇄령이 내려진 뒤 항구의 밤은 소리부터 잃었다. 파도는 방파제를 때렸지만 종도, 밧줄을 감는 선원들의 구령도 없었다. 리라는 푸른 인장이 든 납 상자를 품에 안고 검문등 사이를 걸었다.",
  "카엘은 창고 지붕의 그림자에서 내려와 그녀의 앞을 막았다. 경비대 완장을 찬 손은 칼자루가 아니라 상자의 봉인을 가리켰다. ‘지금 돌아가면 아직 네 이름은 명단에 없어.’ 그가 낮게 말했다.",
  "리라는 젖은 장갑으로 청동 잠금쇠를 눌렀다. 스승이 남긴 경고가 손끝에서 되살아났다. 상자는 배가 아니라 약속을 봉인한다. 이곳에서 열면 북쪽 항로의 등대들이 한꺼번에 그녀를 기억할 터였다.",
  "세관탑의 탐조등이 골목을 훑었다. 카엘은 빈 술통을 굴려 빛을 다른 쪽으로 끌었고, 두 사람은 소금 창고 안으로 몸을 숨겼다. 벽 너머로 봉쇄선의 사슬이 조여 드는 쇳소리가 이어졌다.",
  "상자 안에는 밀수 장부가 아니라 얇은 유리판 하나가 있었다. 푸른 문양이 리라의 맥박에 맞춰 번지자 지도 위에서 사라진 제18등대의 위치가 잠깐 떠올랐다. 카엘의 얼굴에서 마지막 의심이 걷혔다.",
  "‘오늘 배를 보내면 도시는 우리를 배신자로 부를 거야.’ 카엘이 말했다. 리라는 유리판을 다시 감싸며 대답했다. ‘보내지 않으면 열여덟 번째 불빛이 영원히 꺼져.’",
  "새벽 첫 조류가 드는 순간, 두 사람은 검문 인장을 위조하지 않고 정면의 쇠사슬을 풀기로 했다. 리라는 자신의 이름을 통행 기록에 남겼다. 선택의 대가는 숨는 것이 아니라, 훗날 그 기록 앞에 다시 서는 일이었다.",
].join("\n\n");

const scenes = [
  { id: "scene-1", title: "비에 젖은 전언", chapter: 1, status: "canon", text: "리라는 비 내리는 서고에서 스승의 마지막 전언과 푸른 인장을 받는다.", summary: "리라가 인장을 계승한다.", storyTime: "1일차 밤", characters: ["리라", "마렌"], protectedQuotes: [] },
  { id: "scene-3", title: "깨진 등대 지도", chapter: 3, status: "canon", text: "카엘은 지워진 제18등대가 표시된 해도를 훔쳐 리라에게 건넨다.", summary: "카엘과 리라가 불완전한 동맹을 맺는다.", storyTime: "3일차 새벽", characters: ["리라", "카엘"], protectedQuotes: [] },
  { id: "scene-5", title: "소금 의회의 경고", chapter: 5, status: "canon", text: "소금 의회는 항구를 봉쇄하고 푸른 인장을 반역의 증표로 선포한다.", summary: "도시 봉쇄가 예고된다.", storyTime: "4일차 오후", characters: ["리라", "의장 세라"], protectedQuotes: [] },
  { id: "scene-7", title: "봉쇄된 항구", chapter: 7, status: "canon", text: sceneSeven, summary: "리라와 카엘이 봉쇄를 뚫고 제18등대의 단서를 지킨다.", storyTime: "5일차 밤", characters: ["리라", "카엘"], protectedQuotes: ["상자는 배가 아니라 약속을 봉인한다"] },
  { id: "scene-9", title: "검은 조류", chapter: 9, status: "canon", text: "항로에 검은 조류가 번지고 카엘은 봉쇄 기록에 남은 리라의 이름을 지우라는 명령을 거부한다.", summary: "항구의 선택이 정치적 대가로 돌아온다.", storyTime: "7일차", characters: ["카엘", "의장 세라"], protectedQuotes: [] },
  { id: "scene-12", title: "이름의 재판", chapter: 12, status: "canon", text: "리라는 공개 재판에서 자신이 쇠사슬을 풀었다고 인정하고 등대의 존재를 증언한다.", summary: "리라가 선택의 책임을 진다.", storyTime: "10일차", characters: ["리라", "카엘", "의장 세라"], protectedQuotes: [] },
  { id: "scene-18", title: "열여덟 번째 불빛", chapter: 18, status: "canon", text: "바다 끝에서 제18등대가 켜지고, 봉인된 약속은 피난선들의 귀환 항로가 된다.", summary: "항구에서 심은 약속이 먼 결말에서 회수된다.", storyTime: "30일차 새벽", characters: ["리라", "카엘"], protectedQuotes: [] },
];

export const createSeed = () => {
  const initialSnapshotId = "snapshot-initial";
  const seededScenes = structuredClone(scenes);
  const sceneTexts = Object.fromEntries(seededScenes.map((scene) => [scene.id, scene.text]));
  const sceneManifest = seededScenes.map(({ text, ...metadata }) => structuredClone(metadata));
  const state = {
    project: { id: "project-blue-seal", title: "푸른 인장의 밤", subtitle: "봉쇄된 바다와 기억하는 약속", stage: "revision" },
    head: initialSnapshotId,
    scenes: seededScenes,
    feedback: [],
    candidates: [],
    editions: [],
    snapshots: [{
      id: initialSnapshotId,
      label: "초기 원고",
      createdAt: "2026-09-22T00:00:00.000Z",
      sceneTexts,
      sceneManifest,
      manifestHash: createHash("sha256").update(JSON.stringify({ sceneTexts, sceneManifest })).digest("hex"),
    }],
    plans: [
      { id: "plan-characters", title: "인물 호", kind: "characters", description: "리라는 책임을 선택하고 카엘은 명령보다 신뢰를 선택한다.", status: "active" },
      { id: "plan-plot", title: "봉쇄와 등대", kind: "plot", description: "7장의 봉쇄 돌파가 18장의 귀환 항로를 가능하게 한다.", status: "active" },
      { id: "plan-promises", title: "약속 회수", kind: "promises", description: "상자와 제18등대의 약속은 18장에서 반드시 회수한다.", status: "active" },
      { id: "plan-constraints", title: "세계 제약", kind: "constraints", description: "푸른 인장은 기억을 남길 뿐 기억을 지우거나 사실을 창조하지 않는다.", status: "active" },
    ],
    runs: [],
    settings: { providerConfigured: Boolean(process.env.OPENAI_API_KEY), mode: process.env.OPENAI_API_KEY ? "openai-compatible" : "local-demo" },
    drafts: {},
    dependencies: [
      { from: "scene-7", to: "scene-9", type: "consequence", reason: "봉쇄 기록의 정치적 파장", mandatory: true },
      { from: "scene-7", to: "scene-12", type: "consequence", reason: "리라의 공개 책임", mandatory: true },
      { from: "scene-7", to: "scene-18", type: "promise", reason: "제18등대 약속의 먼 회수", mandatory: true },
      { from: "scene-3", to: "scene-7", type: "setup", reason: "깨진 지도 단서", mandatory: false },
    ],
    idempotency: {},
    audit: [],
    outbox: [],
    workspaces: [],
  };
  const context = structuredClone({ plans: state.plans, dependencies: state.dependencies, contextVersion: 0 });
  Object.assign(state.snapshots[0], { schemaVersion: 2, parentSnapshotId: null, narrativeContext: context,
    manifestHash: createHash('sha256').update(canonicalJson({ sceneTexts, sceneManifest, narrativeContext: context })).digest('hex') });
  return initializeBranches(state);
};
