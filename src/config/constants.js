// App Configuration
export const APP_COLLECTION_ID = 'echo-vault-v5-fresh';

// Context version for retrofit tracking - increment when extraction logic changes
export const CURRENT_CONTEXT_VERSION = 1;

// Safety Detection Patterns
export const CRISIS_KEYWORDS = /suicide|kill myself|hurt myself|end my life|want to die|better off dead|no reason to live|end it all|don't want to wake up|better off without me/i;
export const WARNING_INDICATORS = /hopeless|worthless|no point|can't go on|trapped|burden|no way out|give up|falling apart/i;

// Default Safety Plan
export const DEFAULT_SAFETY_PLAN = {
  copingStrategies: [
    { activity: "Box Breathing (4-4-4-4)", notes: "Breathe in 4 sec, hold 4, out 4, hold 4" },
    { activity: "Splash cold water on face", notes: "Activates dive reflex, slows heart rate" },
    { activity: "Hold an ice cube", notes: "Sensory grounding technique" }
  ],
  professionalContacts: [
    { name: "988 Suicide & Crisis Lifeline", phone: "988", type: "crisis" },
    { name: "Crisis Text Line", phone: "741741", type: "crisis" }
  ],
  reasonsForLiving: [],
  supportContacts: [],
  warningSignsPersonal: [],
  warningSignsPhysical: []
};

// Journal Prompts
export const PERSONAL_PROMPTS = [
  { id: 'p1', text: "What are you grateful for today?" },
  { id: 'p2', text: "What is one thing you accomplished today that you're proud of?" },
  { id: 'p3', text: "What was the highlight of your day?" },
  { id: 'p4', text: "What did you learn about yourself today?" },
  { id: 'p5', text: "What are three things that went well today, and why?" },
  { id: 'p6', text: "What is your daily affirmation?" },
  { id: 'p7', text: "What is your intention for today?" },
  { id: 'p8', text: "What is one personal goal you want to focus on this week?" },
  { id: 'p9', text: "What would make today feel like a success?" },
  { id: 'p10', text: "What challenges did you face today, and how did you handle them?" },
  { id: 'p11', text: "How did you take care of yourself today?" },
  { id: 'p12', text: "What made you smile today?" },
  { id: 'p13', text: "What did you do to help someone else today?" },
  { id: 'p14', text: "What's on your mind right now?" }
];

export const WORK_PROMPTS = [
  { id: 'w1', text: "What was your biggest win at work today?" },
  { id: 'w2', text: "What progress did you make on your key priorities?" },
  { id: 'w3', text: "What's one thing you did today that moved the needle?" },
  { id: 'w4', text: "What feedback did you receive today, and how did it land?" },
  { id: 'w5', text: "What was the hardest part of your workday?" },
  { id: 'w6', text: "What's one thing you want to improve in your workflow?" },
  { id: 'w7', text: "What did you learn from a mistake or setback today?" },
  { id: 'w8', text: "What conversation do you need to have that you've been avoiding?" },
  { id: 'w9', text: "What are your top 3 priorities for tomorrow?" },
  { id: 'w10', text: "What's blocking you right now, and what would unblock it?" },
  { id: 'w11', text: "What would make this week a success?" },
  { id: 'w12', text: "Who do you need to connect with this week?" }
];
