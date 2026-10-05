import { useRef, useState } from "react";
import {
  BookOpen,
  GraduationCap,
  ChevronLeft,
  Download,
  History,
  MoreHorizontal,
  Plus,
  Upload,
} from "lucide-react";
import type { AttemptRecord, ExamRecord } from "./storage";
import type { StudyPlanRecord } from "./study-plan";
import type { ExamSetup } from "./exam-setup";
import { TopicPanel } from "./StudyPlans";
import { topicList, topicStatus, topicKey } from "./topics";
import { LibraryPanel, HistoryPanel, type ContinueItem } from "./LibraryScreen";
import { ExamSetupDialog } from "./ExamSetupDialog";
import { Button, EmptyState, LinkButton, OverflowMenu } from "./ui/kit";

type Selection = { kind: "topic"; key: string } | { kind: "library" } | { kind: "history" };

interface Props {
  plans: StudyPlanRecord[];
  attempts: AttemptRecord[];
  library: ExamRecord[];
  continueItem?: ContinueItem;
  dev: boolean;
  /** Resolves to the new plan's id once it is saved. */
  onCreateExam: (setup: ExamSetup) => Promise<string | undefined>;
  onUploadExamFile: (planId: string, files: File[]) => void;
  onImportExample: () => Promise<string | undefined>;
  onDownloadExample: () => void;
  onTask: (planId: string, topicId: string, taskId: string, checked: boolean) => void;
  onNote: (planId: string, topicId: string, note: string) => void;
  onLearned: (planId: string, topicId: string) => void;
  onPractice: (planId: string, topicId: string) => void;
  onAddPractice: (planId: string, topicId: string, files: File[]) => void;
  onStart: (planId: string, topicId: string) => void;
  onRevision: (planId: string, topicId: string) => void;
  onRewrite: (planId: string, topicId: string, exam: ExamRecord) => void;
  onRewriteFiles: (planId: string, topicId: string, files: File[]) => void;
  onOpenAttempt: (attempt: AttemptRecord) => void;
  onReview: (attempt: AttemptRecord) => void;
  // Library
  onStartExam: (exam: ExamRecord) => void;
  onImportFiles: (files: File[]) => void;
  onLoadDemo: () => void;
}

/**
 * The single Exam Workspaces tab. A left rail lists every topic across plans, plus
 * the Library and History; the right pane shows whatever is selected. This is
 * the whole navigation model — no separate top-level tabs, and no title-select.
 */
export function ExamWorkspace(props: Props) {
  const { plans, attempts, library, continueItem } = props;
  const topics = topicList(plans, attempts);
  const [selection, setSelection] = useState<Selection>({ kind: "topic", key: "" });
  const [creating, setCreating] = useState(false);
  const [pane, setPane] = useState<"list" | "detail">("list");
  const importInput = useRef<HTMLInputElement>(null);

  // On a topic selection, resolve the explicit key, else fall back to the first
  // unfinished topic, else the last one — the same rule the old header used.
  const activeTopic =
    selection.kind === "topic"
      ? (topics.find((t) => t.key === selection.key) ??
        topics.find((t) => t.progress?.step !== "done") ??
        topics.at(-1))
      : undefined;

  const openTopic = (key: string) => {
    setSelection({ kind: "topic", key });
    setPane("detail");
  };
  const openSection = (kind: "library" | "history") => {
    setSelection({ kind });
    setPane("detail");
  };

  const newExam = async (setup: ExamSetup) => {
    const id = await props.onCreateExam(setup);
    if (!id) return;
    setCreating(false);
    openTopic(topicKey(id, "exam"));
  };
  const tryExample = async () => {
    const id = await props.onImportExample();
    if (id) openTopic(topicKey(id, "exam"));
  };

  const sidebar = (
    <aside className="exw-side" aria-label="Exams">
      <div className="exw-actions">
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" /> New exam
        </Button>
        <OverflowMenu
          trigger={
            <Button aria-label="More" className="ex-btn--icon">
              <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
          }
          items={[
            {
              label: "Import files",
              icon: <Upload size={16} />,
              onSelect: () => importInput.current?.click(),
            },
            {
              label: "Download example file",
              icon: <Download size={16} />,
              onSelect: props.onDownloadExample,
            },
          ]}
        />
      </div>

      {topics.length > 0 && (
        <>
          <p className="exw-group">Your exams</p>
          {plans.map((plan) => {
            const planTopics = topics.filter((t) => t.record.id === plan.id);
            if (!planTopics.length) return null;
            return (
              <div key={plan.id}>
                {/* A configured exam is its own one-topic plan: no group heading. */}
                {!plan.setup && <p className="exw-plan">{plan.plan.name}</p>}
                {planTopics.map((t) => {
                  const active = selection.kind === "topic" && activeTopic?.key === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className="exw-row"
                      aria-current={active ? "page" : undefined}
                      onClick={() => openTopic(t.key)}
                    >
                      <span
                        className={`exw-status is-${topicStatus(t.progress)}`}
                        aria-hidden="true"
                      />
                      <span className="exw-row-title">{t.topic.title}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="exw-div" aria-hidden="true" />
        </>
      )}

      <p className="exw-group">Browse</p>
      <button
        type="button"
        className="exw-row"
        aria-current={selection.kind === "library" ? "page" : undefined}
        onClick={() => openSection("library")}
      >
        <span className="exw-row-icon" aria-hidden="true">
          <BookOpen size={16} />
        </span>
        <span className="exw-row-title">Library</span>
      </button>
      <button
        type="button"
        className="exw-row"
        aria-current={selection.kind === "history" ? "page" : undefined}
        onClick={() => openSection("history")}
      >
        <span className="exw-row-icon" aria-hidden="true">
          <History size={16} />
        </span>
        <span className="exw-row-title">History</span>
      </button>

      <input
        ref={importInput}
        type="file"
        multiple
        accept=".zip,.json,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
        className="sr-only"
        aria-label="Import files"
        onChange={(e) => {
          props.onImportFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </aside>
  );

  let detail;
  if (selection.kind === "library") {
    detail = (
      <LibraryPanel
        library={library}
        dev={props.dev}
        onStart={props.onStartExam}
        onImportFiles={props.onImportFiles}
        onLoadDemo={props.onLoadDemo}
      />
    );
  } else if (selection.kind === "history") {
    detail = <HistoryPanel attempts={attempts} onOpenAttempt={props.onOpenAttempt} />;
  } else if (activeTopic) {
    detail = (
      <TopicPanel
        item={activeTopic}
        topics={topics}
        library={library}
        onSelect={openTopic}
        onUploadExamFile={props.onUploadExamFile}
        onDownloadExample={props.onDownloadExample}
        onTask={props.onTask}
        onNote={props.onNote}
        onLearned={props.onLearned}
        onPractice={props.onPractice}
        onAddPractice={props.onAddPractice}
        onStart={props.onStart}
        onRevision={props.onRevision}
        onRewrite={props.onRewrite}
        onRewriteFiles={props.onRewriteFiles}
        onOpenAttempt={props.onOpenAttempt}
        onReview={props.onReview}
      />
    );
  } else {
    detail = (
      <>
        <EmptyState
          icon={<GraduationCap size={24} />}
          title="Create an exam to start"
          actions={
            <>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" /> New exam
              </Button>
              <Button onClick={() => void tryExample()}>Try the example</Button>
            </>
          }
        >
          Start with GATE, choose your question count and time, then upload your paper. Keep
          learning materials, practice and exam progress together in this workspace.
        </EmptyState>
        <p className="ex-small" style={{ textAlign: "center", marginTop: 12 }}>
          <LinkButton onClick={props.onDownloadExample}>Download example file</LinkButton>
        </p>
      </>
    );
  }

  return (
    <div className="exw" data-pane={pane} data-empty={topics.length === 0}>
      <ExamSetupDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(s) => void newExam(s)}
      />
      {sidebar}
      <main className="exw-main">
        <button type="button" className="ex-link exw-back" onClick={() => setPane("list")}>
          <ChevronLeft size={16} aria-hidden="true" /> All exams
        </button>
        {continueItem && (
          <section className="ex-surface xl-continue" aria-label="Continue">
            <div>
              <small>{continueItem.label}</small>
              <h2 style={{ fontSize: 18 }}>{continueItem.title}</h2>
              <p className="ex-small">{continueItem.meta}</p>
            </div>
            <Button variant="primary" onClick={continueItem.run}>
              {continueItem.cta}
            </Button>
          </section>
        )}
        {detail}
      </main>
    </div>
  );
}
