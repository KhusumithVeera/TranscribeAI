export type TranscriptWord = {
  id: string;
  text: string;
  start: number; // seconds, relative to original source video
  end: number;   // seconds, relative to original source video
  speakerId?: string;
  deleted: boolean;
  correctedText?: string;
};

export type TranscriptParagraph = {
  id: string;
  speakerId?: string;
  wordIds: string[];
};

export type TimeRange = {
  start: number; // original source time in seconds
  end: number;
};

export type EditDecisionList = {
  deletedRanges: TimeRange[];
  version: number;
};

export type VoiceEnhancementPreset = 'calm_mild' | 'soft_studio' | 'warm_clear';

export type VoiceEnhancementConfig = {
  enabled: boolean;
  preset: VoiceEnhancementPreset;
};

export type SpokenCueSegment = {
  text: string;
  sourceStart: number;
  sourceEnd: number;
};

export type ProjectVideoMeta = {
  projectId: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasAudio: boolean;
  sourceUrl: string;
  isDemo?: boolean;
};

export type TranscribeResponse = {
  projectId: string;
  duration: number;
  languageCode?: string;
  hasWordTimestamps: boolean;
  words: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
  model: string;
};

export type RenderResponse = {
  projectId: string;
  renderHash: string;
  renderUrl: string;
  downloadUrl: string;
  editedDuration: number;
  retainedRanges: TimeRange[];
  deletedRanges: TimeRange[];
  voiceEnhanced: boolean;
  cached: boolean;
};

export type HealthInfo = {
  ok: boolean;
  ffmpegAvailable: boolean;
  demoAvailable: boolean;
  limits: {
    maxDurationSeconds: number;
    maxFileSizeBytes: number;
    allowedExtensions: string[];
  };
};

export type EditHistorySnapshot = {
  words: TranscriptWord[];
  editList: EditDecisionList;
  summary: string;
};
