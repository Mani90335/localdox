# Markdown checkboxes

Write a checklist with `[]` for unchecked tasks and `[y]` for checked tasks:

```md
- [] Review the draft
- [y] Write the outline
```

Click a checkbox in the reader, or focus it and press Space, to update its
marker in the Markdown source. Changes use the normal workspace autosave and
are included when downloading the Markdown file. The Checklist toolbar button
inserts unchecked tasks.

Standalone task lines, nested lists, numbered lists and blockquotes are also
supported. Markers inside code or links stay literal. Standard Markdown tasks
(`- [ ]` and `- [x]`) work too and keep their original notation when toggled.
Use that standard notation when compatibility with other Markdown readers is
required; `[]` and `[y]` are LocalDox extensions.

The source is the persisted state; there is no separate checkbox database.
Each toggle replaces only the marker in the source string and uses the existing
700 ms debounced workspace save. Parsing and rendering still scale with document
size, including the existing progressive rendering path for long documents.
