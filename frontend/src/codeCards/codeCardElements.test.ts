import type { CodeCard } from '../types/CodeCard';
import {
  createCodeCardElements,
  getCodeCardGroupId,
  hasCodeCardContainer,
  isCodeCardStale,
  replaceCodeCardElements,
} from './codeCardElements';

const card: CodeCard = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  file: {
    path: 'frontend/src/App.tsx',
    gitCommit: 'e66b61677b54f0f4c04a82f7c9a86f0f4a2e8a1b',
  },
  range: {
    startLine: 10,
    endLine: 12,
  },
  snapshot: ['export function App() {', '  return <div />;', '}'].join('\n'),
  language: 'typescriptreact',
  customData: {},
};

describe('codeCardElements', () => {
  it('creates grouped Excalidraw elements with CodeTrace custom data', () => {
    const elements = createCodeCardElements(card, { x: 100, y: 200, updated: 123 });
    const groupId = getCodeCardGroupId(card.id);

    expect(elements).toHaveLength(5);
    expect(elements.every(element => element.groupIds instanceof Array)).toBe(true);
    expect(elements.every(element => (element.groupIds as string[]).includes(groupId))).toBe(true);
    expect(elements.every(element => getCustomData(element).kind === 'codeCard')).toBe(true);
    expect(elements.every(element => getCustomData(element).cardId === card.id)).toBe(true);

    const container = getElementByRole(elements, 'container');
    expect(container).toMatchObject({
      type: 'rectangle',
      x: 100,
      y: 200,
      customData: {
        codetrace: {
          filePath: 'frontend/src/App.tsx',
          range: { startLine: 10, endLine: 12 },
          stale: false,
        },
      },
    });
  });

  it('renders a monospace code snapshot with line numbers', () => {
    const elements = createCodeCardElements(card, { updated: 123 });
    const snapshot = getElementByRole(elements, 'snapshot');

    expect(snapshot.type).toBe('text');
    expect(snapshot.fontFamily).toBe(3);
    expect(snapshot.text).toContain('10 | export function App() {');
    expect(snapshot.text).toContain('11 |   return <div />;');
  });

  it('regenerates version nonces when recreating card elements', () => {
    const random = jest.spyOn(Math, 'random');
    random.mockReturnValue(0.1);
    const firstContainer = getElementByRole(createCodeCardElements(card, { updated: 123 }), 'container');

    random.mockReturnValue(0.2);
    const nextContainer = getElementByRole(createCodeCardElements(card, { updated: 123 }), 'container');

    expect(firstContainer.seed).toBe(nextContainer.seed);
    expect(firstContainer.versionNonce).not.toBe(nextContainer.versionNonce);
    random.mockRestore();
  });

  it('adds a stale marker when card custom data marks the snapshot stale', () => {
    const staleCard: CodeCard = {
      ...card,
      customData: {
        stale: true,
      },
    };

    const elements = createCodeCardElements(staleCard, { updated: 123 });
    const staleElements = elements.filter(element =>
      String(getCustomData(element).role).startsWith('staleMarker'),
    );
    const container = getElementByRole(elements, 'container');

    expect(isCodeCardStale(staleCard)).toBe(true);
    expect(staleElements).toHaveLength(2);
    expect(new Set(staleElements.map(element => element.id)).size).toBe(2);
    expect(staleElements.some(element => element.text === 'STALE')).toBe(true);
    expect(container.customData).toMatchObject({
      codetrace: {
        stale: true,
      },
    });
  });

  it('replaces an existing card group in place when stale status changes', () => {
    const unrelatedElement = { id: 'unrelated', type: 'rectangle' };
    const staleCard: CodeCard = {
      ...card,
      customData: {
        stale: true,
      },
    };
    const elements = [
      unrelatedElement,
      ...createCodeCardElements(card, { x: 320, y: 180, updated: 123 }),
    ];

    const nextElements = replaceCodeCardElements(elements, staleCard, { x: 10, y: 20 });
    const container = getElementByRole(nextElements, 'container');
    const staleElements = nextElements.filter(element =>
      String(getCustomData(element).role).startsWith('staleMarker'),
    );

    expect(nextElements[0]).toBe(unrelatedElement);
    expect(container.x).toBe(320);
    expect(container.y).toBe(180);
    expect(staleElements).toHaveLength(2);
  });

  it('detects whether the scene contains a card container', () => {
    const elements = createCodeCardElements(card, { x: 100, y: 200, updated: 123 });

    expect(hasCodeCardContainer(elements, card.id)).toBe(true);
    expect(hasCodeCardContainer(elements, 'missing-card')).toBe(false);
    expect(hasCodeCardContainer([{ id: 'plain', type: 'rectangle' }], card.id)).toBe(false);
  });

  it('accepts nested codetrace stale metadata for future update flows', () => {
    const staleCard: CodeCard = {
      ...card,
      customData: {
        codetrace: {
          stale: true,
        },
      },
    };

    expect(isCodeCardStale(staleCard)).toBe(true);
  });
});

function getElementByRole(elements: Record<string, unknown>[], role: string): Record<string, unknown> {
  const element = elements.find(element => getCustomData(element).role === role);
  if (!element) {
    throw new Error(`Missing element with role ${role}`);
  }

  return element;
}

function getCustomData(element: Record<string, unknown>): Record<string, unknown> {
  const customData = element.customData as { codetrace?: Record<string, unknown> } | undefined;
  return customData?.codetrace ?? {};
}
