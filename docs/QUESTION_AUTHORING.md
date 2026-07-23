# Global Question Library Authoring Guide

Azeroth Arcade stores all trivia content in one permanent SQLite question library. There are no question packs.

Questions are selected at game time using the host's category, difficulty, and question-type filters. Multiple-choice options are generated dynamically from other questions in the same category, so every well-categorized question helps improve the answer pool for other questions.

## Contents

1. [Quick start](#quick-start)
2. [How the library works](#how-the-library-works)
3. [JSON import formats](#json-import-formats)
4. [Question fields](#question-fields)
5. [Text questions](#text-questions)
6. [Image questions and multiple images](#image-questions-and-multiple-images)
7. [Dynamic multiple-choice answers](#dynamic-multiple-choice-answers)
8. [Answer pools](#answer-pools)
9. [Accepted typed answers](#accepted-typed-answers)
10. [Manual distractors](#manual-distractors)
11. [Tags](#tags)
12. [Importing questions permanently](#importing-questions-permanently)
13. [Managing stored questions](#managing-stored-questions)
14. [Validation rules](#validation-rules)
15. [Complete examples](#complete-examples)
16. [Database structure](#database-structure)
17. [Migration from the old pack system](#migration-from-the-old-pack-system)
18. [Authoring checklist](#authoring-checklist)
19. [Troubleshooting](#troubleshooting)

---

## Quick start

1. Start the application:

   ```powershell
   npm run dev
   ```

2. Open [http://localhost:5173](http://localhost:5173).
3. Select **Question library** on the landing page.
4. Paste JSON into **Import questions from JSON**.
5. Select **Validate & preview**.
6. Fix any validation errors.
7. Select **Import questions**.

Imported questions are immediately written to:

```text
data/trivia.db
```

They remain there after restarting the application.

---

## How the library works

Each question is an independent database record with:

- a text or image type;
- a category;
- a difficulty;
- question wording;
- one canonical correct answer;
- accepted typed-answer variants;
- zero or more manually authored distractors;
- zero or more images;
- an optional answer pool;
- optional tags;
- an active or disabled state.

The host does not choose a pack. The host can filter the global library by:

- one or more categories;
- text and/or image questions;
- easy, medium, and/or hard difficulty.

Leaving every option unchecked means “use all.”

The engine shuffles matching active questions. If the host requests more rounds than the number of matching questions, questions repeat after the available set is exhausted.

---

## JSON import formats

The importer accepts either an import object or a raw array.

### Recommended import object

```json
{
  "source": "Dungeon questions batch 1",
  "defaultCategory": "Dungeons",
  "questions": [
    {
      "type": "text",
      "difficulty": "easy",
      "question": "Which dungeon is home to Edwin VanCleef?",
      "correctAnswer": "Deadmines",
      "acceptedAnswers": ["deadmines", "the deadmines", "vc"]
    }
  ]
}
```

`source` is descriptive import metadata used during preview. It is not a pack and does not affect gameplay.

`defaultCategory` is applied to questions that omit `category`.

### Raw question array

Every question must include its own category:

```json
[
  {
    "type": "text",
    "category": "Dungeons",
    "question": "Which dungeon is home to Edwin VanCleef?",
    "correctAnswer": "Deadmines"
  },
  {
    "type": "text",
    "category": "Dungeons",
    "question": "Which dungeon is commonly abbreviated SFK?",
    "correctAnswer": "Shadowfang Keep"
  }
]
```

### Import one question

Imports still use an array, even for one question:

```json
{
  "questions": [
    {
      "type": "text",
      "category": "Geography",
      "question": "What is the capital of Wisconsin?",
      "correctAnswer": "Madison"
    }
  ]
}
```

JSON requires double quotes and does not allow comments or trailing commas.

---

## Question fields

| Field | Type | Required | Behavior |
|---|---|---:|---|
| `type` | string | Yes | `"text"` or `"image"` |
| `category` | string | Yes* | Category used for game filtering and automatic distractors |
| `difficulty` | string | No | `"easy"`, `"medium"`, or `"hard"`; defaults to `"medium"` |
| `question` | string | Yes | Wording shown to players |
| `correctAnswer` | string | Yes | Canonical answer used for scoring and reveal |
| `acceptedAnswers` | string array | No | Additional valid typed answers |
| `images` | array | Image questions | One or more image paths/URLs |
| `image` | string | No | Legacy shorthand for one image; `images` is preferred |
| `answerPool` | string | No | More precise automatic-distractor group within a category |
| `distractors` | string array | No | Manual wrong answers used when automatic candidates are insufficient |
| `answers` | string array | No | Legacy multiple-choice format; wrong values are imported as `distractors` |
| `tags` | string array | No | Searchable organizational metadata for future filtering |
| `active` | boolean | No | Defaults to `true`; disabled questions remain stored but are not selected |

\* `category` can be omitted when the outer import object supplies `defaultCategory`.

### Canonical answer style

`correctAnswer` is displayed prominently during reveal. Use polished display formatting:

```json
"correctAnswer": "J. R. R. Tolkien"
```

Put looser player-input forms in `acceptedAnswers`:

```json
"acceptedAnswers": ["tolkien", "jrr tolkien", "j r r tolkien"]
```

---

## Text questions

Text questions use `"type": "text"` and do not require images.

```json
{
  "type": "text",
  "category": "Dungeons",
  "difficulty": "easy",
  "question": "Which dungeon is home to Edwin VanCleef?",
  "correctAnswer": "Deadmines",
  "acceptedAnswers": [
    "deadmines",
    "the deadmines",
    "vc"
  ],
  "answerPool": "Classic Dungeons",
  "tags": ["classic", "bosses"]
}
```

Write questions that make sense without visible choices. This matters because typed and passive modes hide the multiple-choice options.

Prefer:

```text
Which city is the traditional capital of the orcs?
```

Avoid:

```text
Which of the following is the orc capital?
```

---

## Image questions and multiple images

Image questions use `"type": "image"` and require at least one image.

### String paths

```json
{
  "type": "image",
  "category": "Dungeons",
  "question": "What dungeon is shown?",
  "images": [
    "/uploads/deadmines-entrance.jpg",
    "/uploads/deadmines-ship.jpg"
  ],
  "correctAnswer": "Deadmines"
}
```

### Paths with custom alt text

```json
{
  "type": "image",
  "category": "Dungeons",
  "question": "What dungeon is shown?",
  "images": [
    {
      "path": "/uploads/deadmines-entrance.jpg",
      "altText": "A mine entrance surrounded by wooden scaffolding"
    },
    {
      "path": "/uploads/deadmines-ship.jpg",
      "altText": "A large wooden ship inside an underground cavern"
    }
  ],
  "correctAnswer": "Deadmines"
}
```

When the question is selected for a round, the server randomly chooses one active image. That selected path is stored with the round so every player sees the same image.

### Uploading images

1. Open **Question library**.
2. Choose a PNG, JPEG, WebP, or GIF under **Image clues**.
3. Select **Upload image**.
4. Copy the returned `/uploads/...` path.
5. Add the path to the question's `images` array.

Maximum uploaded file size: 8 MB.

Uploaded files are stored in:

```text
uploads/
```

You can also use a direct public HTTPS image URL. Local uploads are more reliable because third-party sites may remove images or block embedding.

Recommended image practices:

- use a clear crop without answer-revealing text;
- prefer 16:9 or 4:3 images;
- use at least 1280 pixels on the longest side when practical;
- verify important details remain visible on mobile;
- compress large images;
- use only images you have permission to distribute.

---

## Dynamic multiple-choice answers

Questions do not need a fixed A/B/C/D list.

For a question with:

```json
{
  "category": "Dungeons",
  "correctAnswer": "Deadmines"
}
```

the server builds the choices when the round starts:

1. Add the real answer: `Deadmines`.
2. Find canonical answers from other active questions in `Dungeons`.
3. Prefer answers from the same `answerPool`, if one is configured.
4. Randomly select unique wrong answers.
5. Use manual `distractors` if more choices are needed.
6. Shuffle the completed choice list.
7. Store the exact generated choices with the round.

A possible round could show:

```text
Deadmines
Shadowfang Keep
Wailing Caverns
Uldaman
```

Another playthrough can produce a different combination from the same category.

The answer letters are therefore never fixed. Do not write questions that refer to “answer A” or assume the correct answer is in a particular position.

### Building a healthy category

Automatic generation works best when a category contains at least four distinct canonical answers.

For `Dungeons`, create questions whose canonical answers include values such as:

- Deadmines
- Shadowfang Keep
- Wailing Caverns
- Uldaman
- Maraudon
- Scarlet Monastery

Multiple questions may share one canonical answer. Duplicates are removed when choices are generated.

If a category has too few unique answers, add manual `distractors` to affected questions.

---

## Answer pools

`answerPool` is an optional subgroup used to improve distractor quality.

Example:

```json
{
  "category": "Dungeons",
  "answerPool": "Classic Dungeons",
  "correctAnswer": "Deadmines"
}
```

Another question might use:

```json
{
  "category": "Dungeons",
  "answerPool": "Dragonflight Dungeons",
  "correctAnswer": "The Azure Vault"
}
```

Both questions remain in the `Dungeons` category, but multiple-choice generation first looks for wrong answers in the matching answer pool.

Use answer pools when a broad category contains distinct kinds or eras of answers:

| Category | Example answer pools |
|---|---|
| Dungeons | `Classic Dungeons`, `Dragonflight Dungeons` |
| Characters | `Faction Leaders`, `Raid Bosses`, `Dragon Aspects` |
| Locations | `Capital Cities`, `Zones`, `Continents` |
| Items | `Legendary Weapons`, `Tier Sets`, `Consumables` |

Answer pools are free-form strings. Spelling and capitalization should be consistent.

If no matching pool has enough unique answers, the engine continues with other answers from the same category, then manual distractors.

---

## Accepted typed answers

Typed mode checks the submitted answer against:

1. `correctAnswer`;
2. every `acceptedAnswers` value;
3. fuzzy similarity when enabled by the host.

Example:

```json
{
  "correctAnswer": "Blackwing Lair",
  "acceptedAnswers": [
    "blackwing lair",
    "bwl"
  ]
}
```

Exact typed matching is:

- case-insensitive;
- accent/diacritic-insensitive;
- punctuation-insensitive;
- insensitive to repeated and leading/trailing spaces.

For example, these normalize equivalently:

```text
Kel'Thuzad
kelthuzad
  KELTHUZAD
```

Useful accepted answers include:

- abbreviations;
- common nicknames;
- names with and without a leading article;
- alternate spellings or transliterations;
- expanded and shortened names.

The canonical answer is automatically inserted into the accepted-answer table. You do not need to repeat it.

Fuzzy matching is helpful for minor typos but should not replace explicit aliases. Short abbreviations such as `BWL`, `SFK`, or `ICC` should always be listed.

---

## Manual distractors

Manual distractors are optional fallback wrong answers:

```json
{
  "type": "text",
  "category": "Dungeons",
  "question": "Which dungeon is home to Edwin VanCleef?",
  "correctAnswer": "Deadmines",
  "distractors": [
    "Shadowfang Keep",
    "Uldaman",
    "Wailing Caverns"
  ]
}
```

Use them when:

- a category is new and has fewer than four unique canonical answers;
- the question requires unusually specific choices;
- category-generated answers would be technically related but misleading;
- you want guaranteed fallback choices.

Manual distractors are not treated as correct answers elsewhere. If `Uldaman` should participate naturally in the `Dungeons` answer pool, create at least one real question whose `correctAnswer` is `Uldaman`.

### Legacy `answers` compatibility

Older JSON remains importable:

```json
{
  "answers": ["Deadmines", "Shadowfang Keep", "Uldaman", "Wailing Caverns"],
  "correctAnswer": "Deadmines"
}
```

The importer removes `Deadmines` and stores the remaining values as manual distractors. New content should use `distractors`.

---

## Tags

Tags are optional organizational metadata:

```json
"tags": ["classic", "eastern-kingdoms", "bosses"]
```

Tags are stored in normalized relational tables and can be shared by many questions. They do not currently appear in lobby filters, but they are available for future search, themed games, and administrative tools.

Use lowercase, consistent names where possible.

---

## Importing questions permanently

### Validate first

Select **Validate & preview** to:

- parse the JSON;
- validate every question;
- count questions and image questions;
- summarize categories and answer pools;
- preview the first question.

Preview does not modify the database.

### Import

Select **Import questions** after validation passes.

The importer writes all questions in one SQLite transaction. If one database operation fails, none of that import is committed.

Each successful import permanently creates:

- question records;
- categories that do not already exist;
- image references;
- accepted answers;
- manual distractors;
- tags and question-tag links.

There is no pack name and no pack uniqueness requirement. Importing the same JSON twice creates duplicate questions, so validate your library after importing.

### API import

The UI calls:

```http
POST /api/questions/import
Content-Type: application/json
```

The request body is either supported import format described above.

Preview endpoint:

```http
POST /api/questions/preview
```

---

## Managing stored questions

The lower section of **Question library** lists up to 500 matching questions.

You can:

- search question wording and canonical answers;
- filter by category;
- inspect type, difficulty, answer pool, answer, and image count;
- disable or reactivate a question;
- permanently delete a question.

### Disable versus delete

Disable a question when it may be useful later:

- it remains in SQLite;
- it is excluded from games;
- it can be reactivated at any time;
- its images, answers, distractors, and tags remain linked.

Delete a question only when it should be removed permanently.

Deletion can be blocked if completed game history references that question. In that case, disable it instead.

### Direct database location

```text
data/trivia.db
```

Stop the server and make a backup before manually editing SQLite.

---

## Validation rules

### Import object

- `questions` must contain at least one item.
- `source` is optional.
- `defaultCategory` is optional but must be non-empty when supplied.

### Every question

- `type` must be exactly `"text"` or `"image"`.
- `category` must be non-empty unless inherited from `defaultCategory`.
- `question` must be non-empty.
- `correctAnswer` must be non-empty.
- `difficulty` must be `"easy"`, `"medium"`, or `"hard"` when supplied.
- `acceptedAnswers` must contain only non-empty strings.
- `distractors` can contain no more than 20 non-empty strings.
- `tags` can contain no more than 30 non-empty strings.
- `answerPool` must be non-empty when supplied.
- `active` must be a boolean when supplied.
- image questions must contain at least one valid image path or URL.

The importer does not currently detect:

- factual errors;
- duplicate questions;
- duplicate imports;
- semantically duplicate answers;
- broken remote image URLs;
- missing local files;
- misleading categories or answer pools;
- inappropriate or unlicensed media.

---

## Complete examples

### Dungeon library import

```json
{
  "source": "Classic dungeon library",
  "defaultCategory": "Dungeons",
  "questions": [
    {
      "type": "text",
      "difficulty": "easy",
      "question": "Which dungeon is home to Edwin VanCleef?",
      "correctAnswer": "Deadmines",
      "acceptedAnswers": ["deadmines", "the deadmines", "vc"],
      "answerPool": "Classic Dungeons",
      "tags": ["classic", "bosses"]
    },
    {
      "type": "text",
      "difficulty": "easy",
      "question": "Which dungeon is commonly abbreviated SFK?",
      "correctAnswer": "Shadowfang Keep",
      "acceptedAnswers": ["shadowfang keep", "sfk"],
      "answerPool": "Classic Dungeons",
      "tags": ["classic", "silverpine"]
    },
    {
      "type": "text",
      "difficulty": "medium",
      "question": "Which dungeon contains the Disciple of Naralex event?",
      "correctAnswer": "Wailing Caverns",
      "acceptedAnswers": ["wailing caverns", "wc"],
      "answerPool": "Classic Dungeons",
      "tags": ["classic", "barrens"]
    },
    {
      "type": "text",
      "difficulty": "medium",
      "question": "Which dungeon is located in the Badlands and contains ancient titan ruins?",
      "correctAnswer": "Uldaman",
      "acceptedAnswers": ["uldaman", "ulda"],
      "answerPool": "Classic Dungeons",
      "tags": ["classic", "badlands"]
    }
  ]
}
```

Because this import provides four distinct canonical answers in the same category and answer pool, each question can draw its wrong choices from the other three.

### Multi-image dungeon question

```json
{
  "source": "Dungeon screenshot clues",
  "questions": [
    {
      "type": "image",
      "category": "Dungeons",
      "difficulty": "medium",
      "question": "Identify this dungeon.",
      "images": [
        "/uploads/deadmines-entrance.webp",
        "/uploads/deadmines-foundry.webp",
        {
          "path": "/uploads/deadmines-ship.webp",
          "altText": "A pirate ship inside a vast underground cavern"
        }
      ],
      "correctAnswer": "Deadmines",
      "acceptedAnswers": ["deadmines", "the deadmines", "vc"],
      "answerPool": "Classic Dungeons",
      "distractors": ["Ragefire Chasm", "Gnomeregan", "Maraudon"],
      "tags": ["classic", "image-clue"]
    }
  ]
}
```

### General trivia import

```json
[
  {
    "type": "text",
    "category": "US State Capitals",
    "difficulty": "easy",
    "question": "What is the capital of Wisconsin?",
    "correctAnswer": "Madison",
    "acceptedAnswers": ["madison"],
    "answerPool": "US State Capitals"
  },
  {
    "type": "text",
    "category": "US State Capitals",
    "difficulty": "easy",
    "question": "What is the capital of Texas?",
    "correctAnswer": "Austin",
    "acceptedAnswers": ["austin"],
    "answerPool": "US State Capitals"
  },
  {
    "type": "text",
    "category": "US State Capitals",
    "difficulty": "easy",
    "question": "What is the capital of Colorado?",
    "correctAnswer": "Denver",
    "acceptedAnswers": ["denver"],
    "answerPool": "US State Capitals"
  },
  {
    "type": "text",
    "category": "US State Capitals",
    "difficulty": "easy",
    "question": "What is the capital of Oregon?",
    "correctAnswer": "Salem",
    "acceptedAnswers": ["salem"],
    "answerPool": "US State Capitals"
  }
]
```

---

## Database structure

| Table | Purpose |
|---|---|
| `categories` | Unique global category names |
| `questions` | Core question, answer, type, difficulty, answer pool, and active state |
| `question_images` | Any number of images linked to a question |
| `accepted_answers` | Canonical and alternate typed answers |
| `question_distractors` | Optional manually authored wrong answers |
| `tags` | Unique tag names |
| `question_tags` | Many-to-many links between questions and tags |
| `game_sessions` | Played games and their settings |
| `rounds` | Selected question, chosen image, and generated choices for each round |
| `player_answers` | Submitted answers, response times, correctness, and awarded points |

Generated choices and the randomly selected image are saved in `rounds`. This preserves exactly what players saw and ensures server-authoritative consistency.

### Useful SQL

List questions:

```sql
SELECT
  q.id,
  c.name AS category,
  q.type,
  q.difficulty,
  q.question,
  q.correct_answer,
  q.answer_pool,
  q.is_active
FROM questions q
JOIN categories c ON c.id = q.category_id
ORDER BY c.name, q.id;
```

List images for one question:

```sql
SELECT path, alt_text, sort_order, is_active
FROM question_images
WHERE question_id = 12
ORDER BY sort_order, id;
```

List accepted answers:

```sql
SELECT answer_text
FROM accepted_answers
WHERE question_id = 12;
```

Disable a question:

```sql
UPDATE questions
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE id = 12;
```

Prefer the UI for normal management so related data remains consistent.

---

## Migration from the old pack system

On startup, the server detects the former schema by looking for `questions.pack_id`.

When detected, it performs a one-time migration:

1. reads every old question;
2. preserves its category, type, difficulty, wording, answer, image, accepted answers, and old choices;
3. removes the obsolete pack-based content tables;
4. creates the global library schema;
5. imports the old questions into the new library;
6. stores former wrong choices as manual distractors;
7. adds the tag `migrated`.

Old pack names are intentionally discarded because packs no longer exist.

The migration recreates game-history tables because old rounds referenced the obsolete question schema. Existing question content is preserved; old played-game history is not.

Back up `data/trivia.db` before the first startup after upgrading if historical data matters.

---

## Authoring checklist

Before importing:

- [ ] JSON uses double quotes and has no trailing commas.
- [ ] Every question has a meaningful category.
- [ ] Similar answer types use the same category.
- [ ] Broad categories use consistent `answerPool` values.
- [ ] Each category/pool has at least four distinct canonical answers, or manual distractors are supplied.
- [ ] `correctAnswer` is polished for reveal.
- [ ] Common abbreviations and aliases are in `acceptedAnswers`.
- [ ] Image questions contain at least one working image.
- [ ] Images remain recognizable on mobile.
- [ ] Questions make sense in typed mode without visible choices.
- [ ] Questions have one unambiguous correct answer.
- [ ] Difficulty labels are consistent.
- [ ] The import was validated before committing.

After importing:

- [ ] Search the stored-question table for the new records.
- [ ] Test a one-round standard game.
- [ ] Confirm generated choices are plausible.
- [ ] Test elimination mode.
- [ ] Test typed aliases with fuzzy matching on and off.
- [ ] Test every image from a second browser.
- [ ] Disable any question that needs revision.

---

## Troubleshooting

### “Invalid JSON”

Common causes:

- trailing commas;
- single quotes;
- comments;
- missing commas;
- unescaped quotation marks inside strings.

### Category validation error

Add `category` to the question or `defaultCategory` to the import object.

### “Image questions require at least one image path or URL”

Add an `images` array:

```json
"images": ["/uploads/my-image.jpg"]
```

### Import succeeded but the question is not used

Check:

- the question is active;
- the lobby category filter includes its category or no categories are selected;
- its type matches the selected type filters;
- its difficulty matches the selected difficulty filters.

### Multiple choice has fewer than four options

The category and answer pool do not contain enough unique canonical answers, and the question does not have enough manual distractors.

Add more real questions to the category or add:

```json
"distractors": ["Wrong One", "Wrong Two", "Wrong Three"]
```

### Distractors are technically related but poor

Add a more specific `answerPool` to related questions. For example, divide `Dungeons` into `Classic Dungeons` and `Dragonflight Dungeons`.

### Typed answer should count but does not

Add the exact variant to `acceptedAnswers`. Do not rely on fuzzy matching for short abbreviations.

### Image does not load

Verify:

- the uploaded file still exists under `uploads/`;
- the path starts with `/uploads/`;
- filename capitalization and extension match;
- public URLs point directly to an image;
- an HTTPS deployment is not loading an HTTP image.

### Duplicate questions appeared

Imports are append-only and do not deduplicate. Delete or disable the duplicate records in **Question library**.

### Delete is blocked

The question is referenced by game history. Disable it instead.

### Reset the entire library

1. Stop the server.
2. Back up anything you want to keep.
3. Delete `data/trivia.db`.
4. Restart the server.

The schema and built-in starter questions will be recreated. All imported questions and game history will be lost.

---

## Recommended source workflow

Keep your import JSON files in source control even after importing them:

```text
question-library/
  dungeons-classic.json
  dungeon-images.json
  raids.json
  characters.json
```

SQLite is the live persistent library. JSON files are the editable source and backup for bulk content.
