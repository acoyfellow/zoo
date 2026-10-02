export type Starter = { name: string; description: string; code: string };

export const STARTER_COUNT = 4;

export const STARTERS: Starter[] = [
  {
    name: "Seeker",
    description: "a bold orange beetle that walks straight to the nearest creature",
    code: `export default function behave(api, view) {
  const near = view.neighbors[0];
  if (near) api.move(near.dx, near.dy);
  api.say(near ? "hello " + near.name : "alone");
}`,
  },
  {
    name: "Orbit",
    description: "a calm violet moth that circles the middle of the world",
    code: `export default function behave(api, view) {
  const angle = view.tick / 6;
  const tx = view.size / 2 + Math.cos(angle) * 120;
  const ty = view.size / 2 + Math.sin(angle) * 120;
  api.move(tx - view.self.x, ty - view.self.y);
}`,
  },
  {
    name: "Shadow",
    description: "a quiet grey mouse that follows others and remembers who it met",
    code: `export default function behave(api, view) {
  const near = view.neighbors[0];
  if (near) {
    api.move(near.dx * 0.8, near.dy * 0.8);
    if (near.distance < 30) api.remember("met", near.name);
  }
  const met = api.recall("met");
  if (met) api.say("I saw " + met);
}`,
  },
  {
    name: "Drifter",
    description: "a slow green slug that drifts toward the center and greets crowds",
    code: `export default function behave(api, view) {
  api.move((view.size / 2 - view.self.x) / 10, (view.size / 2 - view.self.y) / 10);
  if (view.neighbors.length > 2) api.say("crowd");
}`,
  },
];
