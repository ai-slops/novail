import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/domain/canonical.mjs";
import { initializeBranches } from "./branch-state.mjs";

const sceneSeven = [
  "After the blockade order, the harbor night lost its sound first. Waves struck the breakwater, but there were no bells and no sailors calling as they wound the ropes. Lira carried a lead box bearing the Blue Seal and walked between the checkpoint lamps.",
  "Kael descended from the shadow of a warehouse roof and blocked her path. The hand wearing a guard's armband pointed not to his sword hilt but to the seal on the box. 'Turn back now and your name is still off the list,' he said quietly.",
  "Lira pressed the bronze clasp with a wet glove. Her mentor's warning returned beneath her fingertips. The box seals a promise, not a ship. If she opened it here, every lighthouse on the northern route would remember her at once.",
  "A searchlight from the customs tower swept the alley. Kael rolled an empty barrel to draw the beam away, and they slipped into the salt warehouse. Beyond the wall came the metallic groan of the blockade chain tightening.",
  "Inside the box was no smuggling ledger, only a thin pane of glass. As a blue pattern spread in time with Lira's pulse, the lost location of the Eighteenth Lighthouse flickered across the map. The last doubt left Kael's face.",
  "'If we send the ship tonight, the city will call us traitors,' Kael said. Lira wrapped the glass again. 'If we do not, the eighteenth light will go dark forever.'",
  "At the first turn of the dawn tide, they chose to unfasten the chain in plain sight rather than forge a checkpoint seal. Lira entered her own name in the passage record. The price of her choice was not hiding, but one day standing before that record again.",
].join("\n\n");

const scenes = [
  { id: "scene-1", title: "Message in the Rain", chapter: 1, status: "canon", text: "In a rain-soaked archive, Lira receives her mentor's final message and the Blue Seal.", summary: "Lira inherits the seal.", storyTime: "Day 1, night", characters: ["Lira", "Maren"], protectedQuotes: [] },
  { id: "scene-3", title: "The Broken Lighthouse Chart", chapter: 3, status: "canon", text: "Kael steals a sea chart marking the erased Eighteenth Lighthouse and gives it to Lira.", summary: "Kael and Lira form an uneasy alliance.", storyTime: "Day 3, dawn", characters: ["Lira", "Kael"], protectedQuotes: [] },
  { id: "scene-5", title: "The Salt Council's Warning", chapter: 5, status: "canon", text: "The Salt Council blockades the harbor and declares the Blue Seal a mark of treason.", summary: "The city blockade is announced.", storyTime: "Day 4, afternoon", characters: ["Lira", "Chair Sera"], protectedQuotes: [] },
  { id: "scene-7", title: "The Blockaded Harbor", chapter: 7, status: "canon", text: sceneSeven, summary: "Lira and Kael break through the blockade and protect the clue to the Eighteenth Lighthouse.", storyTime: "Day 5, night", characters: ["Lira", "Kael"], protectedQuotes: ["The box seals a promise, not a ship"] },
  { id: "scene-9", title: "The Black Tide", chapter: 9, status: "canon", text: "A black tide spreads across the route, and Kael refuses an order to erase Lira's name from the blockade record.", summary: "The harbor choice returns with a political cost.", storyTime: "Day 7", characters: ["Kael", "Chair Sera"], protectedQuotes: [] },
  { id: "scene-12", title: "The Trial of a Name", chapter: 12, status: "canon", text: "At a public trial, Lira admits that she unfastened the chain and testifies that the lighthouse exists.", summary: "Lira accepts responsibility for her choice.", storyTime: "Day 10", characters: ["Lira", "Kael", "Chair Sera"], protectedQuotes: [] },
  { id: "scene-18", title: "The Eighteenth Light", chapter: 18, status: "canon", text: "At the edge of the sea, the Eighteenth Lighthouse ignites, and the sealed promise becomes a route home for the refugee ships.", summary: "The promise planted at the harbor pays off in the distant ending.", storyTime: "Day 30, dawn", characters: ["Lira", "Kael"], protectedQuotes: [] },
];

export const createSeed = () => {
  const initialSnapshotId = "snapshot-initial";
  const seededScenes = structuredClone(scenes);
  const sceneTexts = Object.fromEntries(seededScenes.map((scene) => [scene.id, scene.text]));
  const sceneManifest = seededScenes.map(({ text, ...metadata }) => structuredClone(metadata));
  const state = {
    project: { id: "project-blue-seal", title: "Night of the Blue Seal", subtitle: "A Blockaded Sea and a Remembered Promise", stage: "revision" },
    head: initialSnapshotId,
    scenes: seededScenes,
    feedback: [],
    candidates: [],
    editions: [],
    snapshots: [{
      id: initialSnapshotId,
      label: "Initial manuscript",
      createdAt: "2026-09-22T00:00:00.000Z",
      sceneTexts,
      sceneManifest,
      manifestHash: createHash("sha256").update(JSON.stringify({ sceneTexts, sceneManifest })).digest("hex"),
    }],
    plans: [
      { id: "plan-characters", title: "Character arcs", kind: "characters", description: "Lira chooses responsibility, while Kael chooses trust over orders.", status: "active" },
      { id: "plan-plot", title: "The blockade and the lighthouse", kind: "plot", description: "Breaking the blockade in Chapter 7 makes the return route in Chapter 18 possible.", status: "active" },
      { id: "plan-promises", title: "Promise payoff", kind: "promises", description: "The promise of the box and the Eighteenth Lighthouse must pay off in Chapter 18.", status: "active" },
      { id: "plan-constraints", title: "World constraints", kind: "constraints", description: "The Blue Seal can preserve memories, but it cannot erase memories or create facts.", status: "active" },
    ],
    runs: [],
    settings: { providerConfigured: Boolean(process.env.OPENAI_API_KEY), mode: process.env.OPENAI_API_KEY ? "openai-compatible" : "local-demo" },
    drafts: {},
    dependencies: [
      { from: "scene-7", to: "scene-9", type: "consequence", reason: "Political fallout from the blockade record", mandatory: true },
      { from: "scene-7", to: "scene-12", type: "consequence", reason: "Lira's public accountability", mandatory: true },
      { from: "scene-7", to: "scene-18", type: "promise", reason: "Distant payoff of the Eighteenth Lighthouse promise", mandatory: true },
      { from: "scene-3", to: "scene-7", type: "setup", reason: "The broken chart clue", mandatory: false },
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
