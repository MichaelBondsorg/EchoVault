# Phase 1 UAT Plan - AI Companion with Persistent Memory & Advanced Patterns

## Current Status

**Integration Required**: The `UnifiedConversation` component and backend services have been built but need to be wired into the app.

### Accessing the Companion

Currently, to test the companion features:

1. **Chat** - Hamburger menu → "Chat" (uses existing `Chat.jsx`)
2. **Voice** - Hamburger menu → "Voice Chat" (uses existing `RealtimeConversation.jsx`)

**To access the new unified companion**, we need to integrate `UnifiedConversation.jsx` into the app routing.

---

## Pre-UAT Integration Checklist

Before UAT can begin, complete these integration tasks:

### 1. Wire UnifiedConversation into App.jsx

```jsx
// Add to imports in App.jsx
import UnifiedConversation from './components/chat/UnifiedConversation';

// Add view state option
{view === 'companion' && (
  <UnifiedConversation
    entries={visible}
    category={cat}
    onClose={() => setView('feed')}
    onSaveEntry={saveEntry}
  />
)}

// Add menu option in HamburgerMenu
onOpenCompanion={() => setView('companion')}
```

### 2. Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions:onEntryCreateMemoryExtraction,functions:refreshMemory,functions:runMemoryDecay
```

### 3. Create Firestore Indexes

Memory collections need indexes for queries:
- `artifacts/{appId}/users/{userId}/memory/people` - orderBy `lastMentioned`
- `artifacts/{appId}/users/{userId}/memory/events` - orderBy `date`

---

## UAT Test Cases

### Feature 1: AI Companion with Persistent Memory

#### 1.1 Memory Extraction (Automatic)

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| MEM-001 | Person extraction | Create entry: "Had lunch with Sarah today, she's doing well" | Person "Sarah" appears in memory graph |
| MEM-002 | Event extraction | Create entry: "Got promoted at work today!" | Event with type "achievement" created |
| MEM-003 | Value inference | Create entries mentioning family 3+ times | Value "family" added with source "ai_inferred" |
| MEM-004 | Crisis filtering | Create entry with crisis keywords | Memory extraction skipped, no sensitive data stored |
| MEM-005 | Batch extraction | Create 3 entries in quick succession | Single memory update (batch processing) |

#### 1.2 Session Buffer (Sync Gap)

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| BUF-001 | Immediate context | 1. Save entry about "meeting with John" 2. Open chat immediately 3. Ask "What did I just write about?" | Companion knows about John meeting |
| BUF-002 | Buffer expiry | 1. Save entry 2. Wait 10+ minutes 3. Open chat | Session buffer expired, uses permanent memory |

#### 1.3 Enhanced RAG (Tiered Retrieval)

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| RAG-001 | Memory graph context | Ask "Who are the important people in my life?" | Returns people from memory graph |
| RAG-002 | Recent entries | Ask "What have I been thinking about lately?" | Returns last 7 days of entries |
| RAG-003 | Semantic search | Ask about a specific topic you journaled about months ago | Finds semantically similar old entries |
| RAG-004 | De-duplication | Check context doesn't repeat same entry | No duplicate entries in context |
| RAG-005 | Token budget | Inspect context length | Stays under 4500 tokens |

#### 1.4 Guided Sessions

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| GS-001 | Morning check-in | Start "Morning Check-in" session | Shows 4 prompts, captures responses |
| GS-002 | Evening reflection | Start "Evening Reflection" session | Includes gratitude prompt |
| GS-003 | Memory-aware prompts | Start session after using app for 1+ week | Prompts reference your history/patterns |
| GS-004 | Save as entry | Complete guided session | Session saved as journal entry |

#### 1.5 Mindfulness Exercises

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| MF-001 | Box breathing | Start "Box Breathing" exercise | 4s inhale, 4s hold, 4s exhale, 4s hold cycle |
| MF-002 | 5-4-3-2-1 grounding | Start "Grounding" exercise | Interactive prompts for 5 senses |
| MF-003 | Personalized loving kindness | Start "Loving Kindness" with memory | Uses actual people from your journal |
| MF-004 | Exercise completion | Complete any exercise | Shows completion message |

---

### Feature 2: Advanced Pattern Detection

#### 2.1 Association Rule Mining

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| AR-001 | Multi-factor pattern | Journal 15+ entries with exercise + good mood | Pattern: "exercise → mood boost" detected |
| AR-002 | Confidence threshold | Check insights displayed | Only >= 0.75 confidence shown as facts |
| AR-003 | Pending validation | Check lower confidence patterns | 0.5-0.75 shown as questions ("Does this resonate?") |
| AR-004 | Clinical plausibility | Check for spurious patterns | No "weather alone → mood" patterns |

#### 2.2 Sequence Patterns

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| SP-001 | Mood cascade | Journal entries: conflict → isolation → low mood | "Mood cascade" pattern detected |
| SP-002 | Event-based windows | Check pattern windows | Uses mood events as boundaries, not fixed days |
| SP-003 | Pattern explanation | View sequence pattern | Clear explanation of what leads to mood drops |

#### 2.3 Recovery Patterns

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| RP-001 | Recovery signature | Journal through 3+ low periods with recovery | "Recovery signature" identified |
| RP-002 | What helps | Recovery entries mention exercise, friends | Shows "exercise, social connection help you recover" |

#### 2.4 Anomaly Detection

| Test ID | Test Case | Steps | Expected Result |
|---------|-----------|-------|-----------------|
| AN-001 | Mood anomaly | Create entry with very low mood (unusual for you) | Flagged as anomaly |
| AN-002 | Length anomaly | Create unusually long/short entry | Noted in anomaly detection |
| AN-003 | Sentiment mismatch | Positive words but low mood score | Flagged as sentiment mismatch |

---

## Test Data Requirements

### Minimum Data for Pattern Detection

| Pattern Type | Minimum Entries | Data Requirements |
|--------------|-----------------|-------------------|
| Association Rules | 15+ | Variety of activities, people, moods |
| Sequence Patterns | 10+ | At least 2 mood "cycles" (high → low or low → high) |
| Recovery Patterns | 3+ low periods | Entries during low mood AND recovery phase |
| Anomaly Detection | 30+ | Baseline for comparison |

### Synthetic Test Timeline

For thorough testing, create entries simulating:

1. **Week 1-2**: Normal journaling, mention 3-4 people, various activities
2. **Week 3**: Stressful period (work deadline, poor sleep)
3. **Week 4**: Recovery (exercise, social connection)
4. **Week 5**: Return to baseline

---

## Performance Benchmarks

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Memory extraction time | < 5s per entry | Check Cloud Function logs |
| Chat response time | < 3s | Time from send to first token |
| Pattern computation | < 30s for 100 entries | Cloud Function execution time |
| Session buffer read | < 100ms | Browser DevTools |

---

## Known Limitations (Phase 1)

1. **No encrypted PII storage** - Names stored in plain text (encryption is Phase 2)
2. **No user feedback loop UI** - "Confirm"/"Dismiss" insight buttons not implemented
3. **No pattern visualization** - Patterns shown as text, no charts
4. **Cloud Functions required** - Heavy pattern mining runs server-side only

---

## Sign-off Criteria

Phase 1 UAT passes when:

- [ ] All MEM-* tests pass (Memory Extraction)
- [ ] All BUF-* tests pass (Session Buffer)
- [ ] All RAG-* tests pass (Enhanced RAG)
- [ ] All GS-* tests pass (Guided Sessions)
- [ ] All MF-* tests pass (Mindfulness)
- [ ] At least 3 AR-* tests pass (Association Rules - needs data)
- [ ] At least 2 SP-* tests pass (Sequence Patterns - needs data)
- [ ] Performance benchmarks met
- [ ] No critical bugs blocking core functionality

---

## Bug Reporting Template

```markdown
**Test ID**: [e.g., MEM-001]
**Severity**: Critical / High / Medium / Low
**Summary**: [One line description]
**Steps to Reproduce**:
1.
2.
3.

**Expected**: [What should happen]
**Actual**: [What actually happened]
**Screenshots/Logs**: [Attach if applicable]
**Device/Browser**: [e.g., iPhone 14, Safari]
```
