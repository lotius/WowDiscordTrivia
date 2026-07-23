export type GameMode = "standard" | "elimination" | "typed" | "passive";
export type QuestionType = "text" | "image";
export type Difficulty = "easy" | "medium" | "hard";
export type GamePhase =
  | "lobby"
  | "settings"
  | "question"
  | "answering"
  | "reveal"
  | "scoreboard"
  | "final";

export interface Question {
  id: number;
  type: QuestionType;
  category: string;
  difficulty: Difficulty;
  question: string;
  images: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  distractors: string[];
  poolDistractorCandidates: string[];
  distractorCandidates: string[];
  answerPool?: string;
  tags: string[];
  active: boolean;
}

export interface GameSettings {
  mode: GameMode;
  categories: string[];
  difficulties: Difficulty[];
  questionTypes: QuestionType[];
  rounds: number;
  questionTime: number;
  resultsTime: number;
  nextQuestionTime: number;
  basePoints: number;
  speedBonus: boolean;
  streakBonus: boolean;
  fuzzyMatching: boolean;
  fuzzyThreshold: number;
}

export interface Player {
  id: string;
  name: string;
  avatar?: string;
  /**
   * Stable across reconnects, unlike the socket id used as `id`. The Discord
   * user id when the player was identified, otherwise a per-browser id, so
   * unidentified players survive a refresh too.
   */
  playerKey?: string;
  score: number;
  streak: number;
  connected: boolean;
  isHost: boolean;
  hasAnswered: boolean;
  lastAward: number;
}

export interface PublicQuestion {
  id: number;
  type: QuestionType;
  category: string;
  difficulty: Difficulty;
  question: string;
  image?: string;
  answers: string[];
}

export interface Reveal {
  correctAnswer: string;
  correctPlayerIds: string[];
}

export interface RoomState {
  code: string;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  settings: GameSettings;
  roundIndex: number;
  totalRounds: number;
  question?: PublicQuestion;
  questionStartedAt?: number;
  deadline?: number;
  transitionDeadline?: number;
  eliminatedAnswers: string[];
  reveal?: Reveal;
}

export interface ImageInput {
  path: string;
  altText?: string;
}

export interface QuestionInput {
  type: QuestionType;
  category: string;
  difficulty?: Difficulty;
  question: string;
  images?: Array<string | ImageInput>;
  image?: string;
  correctAnswer: string;
  acceptedAnswers?: string[];
  distractors?: string[];
  answers?: string[];
  answerPool?: string;
  tags?: string[];
  active?: boolean;
}

export interface LibraryImportInput {
  source?: string;
  defaultCategory?: string;
  questions: QuestionInput[];
}
