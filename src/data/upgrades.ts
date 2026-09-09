import type { UpgradeCard } from '../entities/types';

/**
 * 레벨업 때 뽑는 카드 목록 (DESIGN 4번).
 *
 * 여기는 데이터만 둔다 — 카드를 하나 늘리는 일이 이 파일 한 곳 수정으로 끝나야 한다
 * (DESIGN: 모듈 구성의 `data/`). 고르는 규칙과 적용은 `systems/upgrades.ts`에 있다.
 *
 * 지금은 일곱 종류다. 셋을 뽑아야 하므로 최소 세 종류가 필요하고, 넷을 넘으면 판마다
 * 조합이 달라진다. 회복 같은 것은 DESIGN 8번에서 한 바퀴에 하나씩 더 붙인다.
 *
 * **효과는 비율이면 곱셈이다.** 덧셈으로 두면 여러 장 겹쳤을 때 값이 0 밑으로 내려가거나
 * (발사 간격) 밸런스가 갑자기 무너진다. 곱셈은 겹칠수록 이득이 완만하게 줄어든다.
 * **개수는 예외로 덧셈(`add`)을 쓴다** — 화살 1.5발은 없다. 대신 개수는 곱셈처럼
 * 스스로 완만해지지 않으므로 `maxStacks`를 짧게 잡아 상한으로 막는다
 * (다중 발사·관통·튕김 모두 2장).
 *
 * `maxStacks`는 "그 값이 더 커져도 게임이 이상해지지 않는" 선에서 잡았다.
 * 예: 연사 8장이면 발사 간격 0.38s → 0.16s.
 */
export const UPGRADE_CARDS: readonly UpgradeCard[] = [
  {
    id: 'rapid',
    title: '연사',
    detail: '발사 간격 10% 감소',
    maxStacks: 8,
    accent: '#ffd479',
    multiply: { fireCooldown: 0.9 },
  },
  {
    id: 'swift',
    title: '질주',
    detail: '이동 속도 7% 증가',
    maxStacks: 8,
    accent: '#7bffcf',
    multiply: { moveSpeed: 1.07 },
  },
  {
    id: 'magnet',
    title: '끌어당김',
    detail: '코어를 끌어오는 거리 25% 증가',
    maxStacks: 6,
    accent: '#5ec8ff',
    multiply: { magnetRadius: 1.25 },
  },
  {
    id: 'multishot',
    title: '다중 발사',
    detail: '화살이 한 번에 2발 더 나간다',
    // 1발 → 3발 → 5발. 개수가 는 만큼 초당 피해가 그대로 곱해지므로 두 장에서 멈춘다.
    // 가운데 한 발은 늘 남는다(짝수로 늘리면 정면에 아무것도 안 나가 조준이 어긋나 보인다).
    maxStacks: 2,
    accent: '#ff9f6e',
    add: { arrowCount: 2 },
  },
  {
    id: 'pierce',
    title: '관통',
    detail: '화살이 적 1명을 더 뚫고 지나간다',
    // 0 → 1 → 2명. 다중 발사와 같은 이유로 두 장에서 멈춘다(개수는 겹칠수록 이득이
    // 줄지 않는다). 다중 발사 2장과 겹치면 한 뭉치가 최대 15번 맞히므로,
    // 이 상한을 올리려면 `tests/progression.test.ts`의 한 판 길이부터 다시 본다.
    maxStacks: 2,
    accent: '#ff7ad9',
    add: { pierce: 1 },
  },
  {
    id: 'bounce',
    title: '튕김',
    detail: '화살이 다음 적에게 1번 더 튕긴다',
    // 0 → 1 → 2번. 관통과 같은 이유로 두 장에서 멈춘다.
    // **관통과 겹치면 뚫는 몫을 먼저 쓰고, 다 쓴 자리에서 꺾는다**(`systems/combat.ts`).
    // 튕겨 갈 상대를 찾는 거리는 `ARROW.bounceRange`(14m)다 — 그 안에 아무도 없으면
    // 그냥 사라진다. 이 상한이나 거리를 올리려면 `tests/progression.test.ts`의
    // 한 판 길이부터 다시 본다.
    maxStacks: 2,
    // 남은 색 사이에서 가장 먼 자리(연두). 노랑·주황·민트·파랑·보라·분홍과 섞이지 않는다.
    accent: '#8ef859',
    add: { bounce: 1 },
  },
  {
    id: 'refine',
    title: '정제',
    detail: '코어 경험치 12% 증가',
    maxStacks: 8,
    accent: '#c9a6ff',
    multiply: { xpMultiplier: 1.12 },
  },
];
