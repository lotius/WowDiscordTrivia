import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../environment";

const example = `{
  "source": "Dungeon questions batch 1",
  "defaultCategory": "Dungeons",
  "questions": [
    {
      "type": "image",
      "difficulty": "medium",
      "question": "What dungeon is shown in this image?",
      "images": [
        "/uploads/deadmines-entrance.jpg",
        {
          "path": "/uploads/deadmines-ship.jpg",
          "altText": "A large wooden ship inside a cavern"
        }
      ],
      "correctAnswer": "Deadmines",
      "acceptedAnswers": ["deadmines", "the deadmines", "vc"],
      "answerPool": "Classic Dungeons",
      "tags": ["classic", "eastern-kingdoms"]
    },
    {
      "type": "text",
      "difficulty": "easy",
      "question": "Which dungeon is home to Edwin VanCleef?",
      "correctAnswer": "Deadmines",
      "acceptedAnswers": ["deadmines", "the deadmines", "vc"],
      "answerPool": "Classic Dungeons",
      "distractors": ["Shadowfang Keep", "Uldaman", "Wailing Caverns"],
      "tags": ["classic", "bosses"]
    }
  ]
}`;

interface LibraryQuestion {
  id: number;
  type: "text" | "image";
  difficulty: string;
  question: string;
  correctAnswer: string;
  answerPool?: string;
  active: number;
  category: string;
  imageCount: number;
}

interface Preview {
  import: {
    source?: string;
    questions: Array<{ question: string }>;
  };
  summary: {
    questionCount: number;
    imageCount: number;
    categories: string[];
    answerPools: string[];
  };
}

export function Admin({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [json, setJson] = useState(example);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [questions, setQuestions] = useState<LibraryQuestion[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<Array<{ name: string }>>([]);
  const [token, setToken] = useState(localStorage.getItem("trivia-admin-token") || "");
  const [unlocked, setUnlocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The token gates every library route. It lives in localStorage rather than
  // the bundle so players who launch the activity never receive it.
  const authHeaders = (extra: Record<string, string> = {}) => ({ ...extra, "x-admin-token": token });

  async function loadLibrary() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    const [questionsResponse, categoriesResponse] = await Promise.all([
      fetch(apiUrl(`/api/questions?${params}`), { headers: authHeaders() }),
      fetch(apiUrl("/api/categories"))
    ]);
    if (questionsResponse.status === 401 || questionsResponse.status === 503) {
      setUnlocked(false);
      setMessage((await questionsResponse.json()).error || "Enter the admin token to manage the library.");
      return;
    }
    setUnlocked(true);
    if (questionsResponse.ok) setQuestions(await questionsResponse.json());
    if (categoriesResponse.ok) setCategories(await categoriesResponse.json());
  }

  useEffect(() => {
    if (!token) return;
    const timeout = window.setTimeout(() => { loadLibrary().catch(() => undefined); }, 150);
    return () => window.clearTimeout(timeout);
  }, [search, category, token]);

  function saveToken(value: string) {
    setToken(value);
    localStorage.setItem("trivia-admin-token", value);
  }

  async function request(action: "preview" | "import") {
    try {
      const body = JSON.parse(json);
      const response = await fetch(
        apiUrl(action === "preview" ? "/api/questions/preview" : "/api/questions/import"),
        {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body)
        }
      );
      const data = await response.json();
      if (!response.ok) {
        const issue = data.issues?.[0];
        const location = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
        throw new Error(data.error || `${location}${issue?.message || "Request failed."}`);
      }
      if (action === "preview") {
        setPreview(data);
        setMessage("Validation passed. Nothing has been written yet.");
      } else {
        setMessage(`${data.imported} question${data.imported === 1 ? "" : "s"} imported permanently.`);
        await loadLibrary();
        onImported();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid JSON.");
    }
  }

  async function uploadImage() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("image", file);
    const response = await fetch(apiUrl("/api/images"), { method: "POST", body, headers: authHeaders() });
    const data = await response.json();
    if (response.ok) {
      setImagePath(data.path);
      setMessage("Image uploaded. Copy its path into a question's images array.");
    } else setMessage(data.error || "Upload failed.");
  }

  async function toggleQuestion(question: LibraryQuestion) {
    const response = await fetch(apiUrl(`/api/questions/${question.id}`), {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ active: !question.active })
    });
    if (response.ok) {
      await loadLibrary();
      onImported();
    }
  }

  async function removeQuestion(question: LibraryQuestion) {
    if (!window.confirm(`Permanently delete question #${question.id}?`)) return;
    const response = await fetch(apiUrl(`/api/questions/${question.id}`), {
      method: "DELETE",
      headers: authHeaders()
    });
    const data = await response.json();
    setMessage(response.ok ? "Question deleted." : data.error || "Delete failed.");
    if (response.ok) {
      await loadLibrary();
      onImported();
    }
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <span className="eyebrow">Game master tools</span>
          <h1>Question library</h1>
        </div>
        <div className="admin-auth">
          <input
            type="password"
            value={token}
            onChange={(event) => saveToken(event.target.value)}
            placeholder="Admin token"
            aria-label="Admin token"
          />
          <span className={unlocked ? "auth-pill auth-pill--ok" : "auth-pill"}>
            {unlocked ? "Unlocked" : "Locked"}
          </span>
          <button className="button button--ghost" onClick={onClose}>Back to game</button>
        </div>
      </header>
      {!unlocked && (
        <div className="notice notice--warn">
          The question library is protected because it exposes correct answers. Paste
          the <code>ADMIN_TOKEN</code> from your <code>.env</code> above to unlock it.
        </div>
      )}
      <main className="library-admin">
        <section className="admin-grid">
          <div className="panel admin-editor">
            <h2>Import questions from JSON</h2>
            <p>Import one or many questions into the permanent global library.</p>
            <textarea value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} />
            <div className="button-row">
              <button className="button button--secondary" onClick={() => request("preview")}>Validate & preview</button>
              <button className="button button--primary" onClick={() => request("import")}>Import questions</button>
            </div>
          </div>
          <div className="admin-side">
            <div className="panel">
              <h2>Image clues</h2>
              <p>PNG, JPEG, WebP, or GIF up to 8 MB. A question can reference multiple uploaded images.</p>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
              <button className="button button--secondary button--full" onClick={uploadImage}>Upload image</button>
              {imagePath && <code className="path-copy">{imagePath}</code>}
            </div>
            <div className="panel preview-card">
              <h2>Import preview</h2>
              {preview ? (
                <>
                  <strong>{preview.import.source || "Untitled import"}</strong>
                  <p>{preview.summary.questionCount} questions · {preview.summary.imageCount} image questions</p>
                  <p>{preview.summary.categories.join(", ")}</p>
                  <div className="preview-question">{preview.import.questions[0].question}</div>
                </>
              ) : <p>Validate JSON to see its summary and first question here.</p>}
            </div>
            {message && <div className="notice">{message}</div>}
          </div>
        </section>

        <section className="panel library-panel">
          <div className="library-heading">
            <div>
              <h2>Stored questions</h2>
              <p>{questions.length} shown. Disabled questions remain stored but are not selected for games.</p>
            </div>
            <div className="library-filters">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions or answers" />
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </div>
          </div>
          <div className="library-table-wrap">
            <table className="library-table">
              <thead><tr><th>ID</th><th>Question</th><th>Category</th><th>Answer pool</th><th>Answer</th><th>Status</th><th /></tr></thead>
              <tbody>
                {questions.map((question) => (
                  <tr key={question.id} className={question.active ? "" : "is-disabled"}>
                    <td>{question.id}</td>
                    <td><strong>{question.question}</strong><small>{question.type} · {question.difficulty}{question.imageCount ? ` · ${question.imageCount} images` : ""}</small></td>
                    <td>{question.category}</td>
                    <td>{question.answerPool || "Category default"}</td>
                    <td>{question.correctAnswer}</td>
                    <td><button className="text-action" onClick={() => toggleQuestion(question)}>{question.active ? "Active" : "Disabled"}</button></td>
                    <td><button className="text-action text-action--danger" onClick={() => removeQuestion(question)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
