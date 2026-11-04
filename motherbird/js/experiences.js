import db from './storage.js';
import { walletBalance } from './step-wallet.js?v=20261104-step-wallet-1';

export const EXPERIENCE_LIBRARY = Object.freeze([
  experience({
    id: 'mount-fuji', title: 'Mount Fuji', kind: 'virtual-ascent',
    summary: 'Follow the mountain from its cultural foothills toward the summit.',
    learning: [
      { id: 'geography', title: 'A stratovolcano', body: 'Mount Fuji rises on Honshu near the boundary of the Shizuoka and Yamanashi prefectures.' },
      { id: 'culture', title: 'A cultural landscape', body: 'Pilgrimage routes, shrines, art, and literature are part of the mountain’s history as well as its elevation.' }
    ],
    milestones: [
      { id: 'base-1', title: 'Base Camp 1', stepCost: 2500, badge: 'Fuji Foothills' },
      { id: 'base-2', title: 'Base Camp 2', stepCost: 3500, badge: 'Fuji Treeline' },
      { id: 'base-3', title: 'Base Camp 3', stepCost: 4500, badge: 'Fuji High Trail' },
      { id: 'summit', title: 'Summit', stepCost: 6000, badge: 'Fuji Summit' }
    ]
  }),
  experience({
    id: 'walk-manhattan', title: 'Walk Manhattan', kind: 'virtual-distance',
    summary: 'Trace Manhattan’s length through changing neighborhoods and landscapes.',
    learning: [
      { id: 'island', title: 'An island of neighborhoods', body: 'Manhattan’s street grid, shorelines, parks, and neighborhood histories reveal different layers of the city.' }
    ],
    milestones: [
      { id: 'downtown', title: 'Lower Manhattan', stepCost: 4000, badge: 'Downtown Walker' },
      { id: 'midtown', title: 'Midtown', stepCost: 5000, badge: 'Midtown Walker' },
      { id: 'uptown', title: 'Upper Manhattan', stepCost: 6000, badge: 'Manhattan End to End' }
    ]
  }),
  experience({
    id: 'empire-state', title: 'Empire State Building', kind: 'virtual-elevation',
    summary: 'Convert walking effort into a virtual climb through an Art Deco landmark.',
    learning: [
      { id: 'architecture', title: 'Art Deco engineering', body: 'The building joined architectural ornament with a steel-frame construction schedule of unusual speed.' }
    ],
    milestones: [
      { id: 'lobby', title: 'Lobby', stepCost: 1000, badge: 'Art Deco Arrival' },
      { id: 'observatory', title: '86th Floor', stepCost: 4500, badge: 'Observatory Climber' },
      { id: 'top', title: 'Top Deck', stepCost: 2500, badge: 'Empire State Summit' }
    ]
  })
]);

export function listExperiences() {
  return EXPERIENCE_LIBRARY.map(({ learning, ...item }) => ({ ...item, learningTopicCount: learning.length }));
}

// Knowledge is read directly from the installed catalogue. Wallet state is
// deliberately not accepted by this function and cannot gate its result.
export function experienceKnowledge(experienceId) {
  const item = findExperience(experienceId);
  return { experienceId: item.id, title: item.title, summary: item.summary, topics: item.learning.map((topic) => ({ ...topic })), access: 'always-available' };
}

export async function unlockExperienceMilestone(experienceId, milestoneId, { at = new Date().toISOString() } = {}) {
  const item = findExperience(experienceId);
  const milestoneIndex = item.milestones.findIndex((candidate) => candidate.id === milestoneId);
  const milestone = item.milestones[milestoneIndex];
  if (!milestone) throw new Error(`Unknown experience milestone: ${milestoneId}`);
  return db.spendSteps({
    experienceId: item.id,
    milestoneId: milestone.id,
    steps: milestone.stepCost,
    badge: milestone.badge,
    title: milestone.title,
    prerequisiteMilestoneId: milestoneIndex > 0 ? item.milestones[milestoneIndex - 1].id : null,
    at
  });
}

export async function experienceProgress(experienceId) {
  findExperience(experienceId);
  return await db.get('experience_progress', experienceId) || { id: experienceId, unlockedMilestoneIds: [], badges: [], localOnly: true };
}

export async function experienceLibraryState() {
  const [ledger, progressRecords] = await Promise.all([db.all('step_ledger'), db.all('experience_progress')]);
  const progress = new Map(progressRecords.map((record) => [record.id, record]));
  return {
    balance: walletBalance(ledger),
    experiences: EXPERIENCE_LIBRARY.map((item) => ({
      id: item.id, title: item.title, kind: item.kind, summary: item.summary,
      knowledge: experienceKnowledge(item.id),
      milestones: item.milestones.map((milestone) => ({ ...milestone })),
      progress: progress.get(item.id) || { id: item.id, unlockedMilestoneIds: [], badges: [], localOnly: true }
    }))
  };
}

function findExperience(id) {
  const item = EXPERIENCE_LIBRARY.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown experience: ${id}`);
  return item;
}

function experience(value) {
  return Object.freeze({ ...value, learning: Object.freeze(value.learning.map(Object.freeze)), milestones: Object.freeze(value.milestones.map(Object.freeze)) });
}

