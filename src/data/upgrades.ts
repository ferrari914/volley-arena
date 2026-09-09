import type { UpgradeCard } from '../entities/types';

/**
 * 레벨업 때 뽑는 카드 목록 (DESIGN 4번).
 *
 * 여기는 데이터만 둔다 — 카드를 하나 늘리는 일이 이 파일 한 곳 수정으로 끝나야 한다
 * (DESIGN: 모듈 구성의 `data/`). 고르는 규칙과 적용은 `systems/upgrades.ts`에 있다.
 *
 * 지금은 네 종류다. 셋을 뽑아야 하므로 최소 세 종류가 필요하고, 넷이면 판마다
 * 조합이 달라진다. 관통·다중 발사·튕김 같은 것은 DESIGN 8번에서 한 바퀴에 하나씩 붙인다.
 *
 * **효과는 전부 곱셈이다.** 덧셈으로 두면 여러 장 겹쳤을 때 값이 0 밑으로 내려가거나
 * (발사 간격) 밸런스가 갑자기 무너진다. 곱셈은 겹칠수록 이득이 완만하게 줄어든다.
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
    id: 'refine',
    title: '정제',
    detail: '코어 경험치 12% 증가',
    maxStacks: 8,
    accent: '#c9a6ff',
    multiply: { xpMultiplier: 1.12 },
  },
];
