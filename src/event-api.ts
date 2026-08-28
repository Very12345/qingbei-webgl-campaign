export type CampaignEventCardSpec = {
  title: string;
  body: string;
  effect: string;
  quadrant: "arrival" | "march" | "lake" | "classroom";
  date: string;
  image?: string;
  sourceType?: string;
  sourceUrl?: string;
};

export type CampaignEventHookContext<TGame = unknown> = {
  game: TGame;
  elapsedHours: number;
  hasFired: (id: string) => boolean;
  trigger: (
    id: string,
    card: CampaignEventCardSpec,
    apply?: () => void,
  ) => boolean;
};

export type CampaignEventHook<TGame = unknown> = {
  id: string;
  card: CampaignEventCardSpec;
  when: (context: CampaignEventHookContext<TGame>) => boolean;
  apply?: (context: CampaignEventHookContext<TGame>) => void;
  aiHints?: {
    baseUtility: number;
    tags?: string[];
    maxAcceptableLossRatio?: number;
  };
};

const eventHooks = new Map<string, CampaignEventHook<any>>();

export const defineEventCatalog = <
  T extends Record<string, CampaignEventCardSpec>,
>(catalog: T) => Object.freeze(catalog);

export const registerCampaignEvent = <TGame = unknown>(
  hook: CampaignEventHook<TGame>,
) => {
  if (!hook.id.trim()) throw new Error("Event hook id is required");
  eventHooks.set(hook.id, hook as CampaignEventHook<any>);
  return () => eventHooks.delete(hook.id);
};

export const unregisterCampaignEvent = (id: string) => eventHooks.delete(id);

export const listCampaignEvents = () =>
  [...eventHooks.values()].map(({ id, card }) => ({ id, card }));

export const runCampaignEventHooks = <TGame>(
  context: CampaignEventHookContext<TGame>,
) => {
  for (const hook of eventHooks.values()) {
    if (context.hasFired(hook.id) || !hook.when(context)) continue;
    context.trigger(hook.id, hook.card, () => hook.apply?.(context));
  }
};

if (typeof window !== "undefined") {
  Object.assign(window as Window & { QingbeiEventAPI?: unknown }, {
    QingbeiEventAPI: {
      register: registerCampaignEvent,
      unregister: unregisterCampaignEvent,
      list: listCampaignEvents,
    },
  });
}
