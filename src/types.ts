export type GameMode = "standard" | "elimination" | "typed" | "passive";
export type GamePhase = "lobby" | "settings" | "question" | "answering" | "reveal" | "scoreboard" | "final";

export interface GameSettings {
  mode: GameMode;
  categories: string[];
  difficulties: Array<"easy" | "medium" | "hard">;
  questionTypes: Array<"text" | "image">;
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
  score: number;
  streak: number;
  connected: boolean;
  isHost: boolean;
  hasAnswered: boolean;
  lastAward: number;
}

export interface PublicQuestion {
  id: number;
  type: "text" | "image";
  category: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  image?: string;
  answers: string[];
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
  reveal?: {
    correctAnswer: string;
    correctPlayerIds: string[];
  };
}

export interface CategorySummary {
  name: string;
  questionCount: number;
}
