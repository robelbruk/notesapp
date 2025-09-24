// src/App.jsx
import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { Authenticator, View, withAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import outputs from "../amplify_outputs.json";

// Amplify Data client (GraphQL)
import { generateClient } from "aws-amplify/data";

// Amplify Storage helpers (v6)
import { uploadData, getUrl, remove } from "aws-amplify/storage";

// Configure Amplify from the generated outputs file
Amplify.configure(outputs);

// Create the Data client (typed if you’re in TS; JS works as-is)
const client = generateClient();

export default function App() {
  const [notes, setNotes] = useState([]);
  const [formState, setFormState] = useState({
    name: "",
    description: "",
    file: null,
  });
  const [loading, setLoading] = useState(false);

  // --- Helpers ---
  const onChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "file") {
      setFormState((s) => ({ ...s, file: files?.[0] ?? null }));
    } else {
      setFormState((s) => ({ ...s, [name]: value }));
    }
  };

  // Fetch Notes and resolve signed URLs for images
  const fetchNotes = async () => {
    setLoading(true);
    try {
      const { data, errors } = await client.models.Note.list();
      if (errors) console.error(errors);

      // For each note with an image key, get a temporary URL for display
      const withUrls = await Promise.all(
        (data ?? []).map(async (n) => {
          if (n.image) {
            try {
              const url = await getUrl({ key: n.image });
              return { ...n, imageUrl: url?.url?.toString() };
            } catch {
              return { ...n, imageUrl: null };
            }
          }
          return { ...n, imageUrl: null };
        })
      );

      // newest first (optional)
      withUrls.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setNotes(withUrls);
    } finally {
      setLoading(false);
    }
  };

  // Create a Note, optionally uploading an image first
  const createNote = async (e) => {
    e.preventDefault();
    if (!formState.name?.trim()) return;

    setLoading(true);
    try {
      let imageKey = null;

      if (formState.file) {
        // example key: media/{identityId}/<timestamp>-<filename>
        // identity-aware prefixes are configured on the backend storage resource
        const key = `media/{entity_id}/${Date.now()}-${formState.file.name}`;
        await uploadData({
          key,
          data: formState.file,
          options: {
            contentType: formState.file.type || "application/octet-stream",
          },
        }).result;
        imageKey = key;
      }

      const { data, errors } = await client.models.Note.create({
        name: formState.name,
        description: formState.description || "",
        image: imageKey, // store S3 key in the model
      });
      if (errors) console.error(errors);

      // Reset form and refresh list
      setFormState({ name: "", description: "", file: null });
      await fetchNotes();
      return data;
    } finally {
      setLoading(false);
    }
  };

  // Delete a Note and its image (if present)
  const deleteNote = async (note) => {
    setLoading(true);
    try {
      if (note.image) {
        // best-effort delete of the associated file
        try {
          await remove({ key: note.image });
        } catch {
          // swallow storage errors so the record still deletes
        }
      }
      await client.models.Note.delete({ id: note.id });
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <View className="App" style={{ maxWidth: 960, margin: "0 auto" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h1>Notes</h1>
            <div>
              <span style={{ marginRight: 12 }}>
                {user?.signInDetails?.loginId || user?.username}
              </span>
              <button onClick={signOut}>Sign out</button>
            </div>
          </header>

          <section style={{ marginBottom: 24 }}>
            <form onSubmit={createNote} style={{ display: "grid", gap: 12 }}>
              <input
                name="name"
                placeholder="Note title"
                value={formState.name}
                onChange={onChange}
                required
              />
              <textarea
                name="description"
                placeholder="Description"
                rows={3}
                value={formState.description}
                onChange={onChange}
              />
              <input
                type="file"
                name="file"
                accept="image/*"
                onChange={onChange}
              />
              <button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Create Note"}
              </button>
            </form>
          </section>

          <section>
            {loading && notes.length === 0 ? <p>Loading…</p> : null}
            {notes.length === 0 && !loading ? <p>No notes yet.</p> : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 16,
              }}
            >
              {notes.map((note) => (
                <article
                  key={note.id}
                  className="box"
                  style={{
                    border: "1px solid #444",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>{note.name}</h3>
                  {note.imageUrl ? (
                    <img
                      src={note.imageUrl}
                      alt={note.name}
                      style={{ width: "100%", borderRadius: 8, marginBottom: 8 }}
                    />
                  ) : null}
                  {note.description ? <p>{note.description}</p> : null}
                  <button onClick={() => deleteNote(note)} disabled={loading}>
                    Delete
                  </button>
                </article>
              ))}
            </div>
          </section>
        </View>
      )}
    </Authenticator>
  );
}
