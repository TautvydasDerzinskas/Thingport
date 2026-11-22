import { byId } from "./articles.js";
import { drawDiagram, flameIcon } from "./diagrams.js";
import {
  gradeItem,
  gradeQuiz,
  makeAttempt,
  passingPoints,
  pictureCount,
  questionBank,
  questionCount,
  totalPoints,
} from "./quiz.js";
import { button, node, pageTitle } from "./ui.js";

const quizModes = {
  practice: {
    label: "Practice",
    start: "Start practice",
    about: () =>
      `${questionCount} questions from a bank of ${questionBank.length}, at least ${pictureCount} with pictures, marked as you answer. Practice doesn’t count toward the badge.`,
  },
  exam: {
    label: "Exam",
    start: "Start exam",
    about: () =>
      `${questionCount} questions graded at the end. Pass with ${passingPoints} of ${totalPoints} points to earn FDM Fundamentals.`,
  },
};

// Pick-the-picture options whose own alt text would name the defect get a description of what's visible instead.
const neutralAlts = {
  "first-layer": "Overhead view of a flat orange patch of parallel rounded lines with dark gaps between them.",
  "under-extrusion": "An upright orange wall with rows of narrow holes and thin lines.",
  "poor-bridging": "Orange strands hang down under a span between two printed legs.",
  "top-gaps": "Irregular holes in a flat orange top surface show crosshatched lines underneath.",
};

export function newExam(mode = "practice") {
  return {
    mode,
    questions: [],
    answers: [],
    checked: [],
    index: 0,
    result: null,
    awardStatus: null,
    checking: false,
    streak: 0,
  };
}

function start(exam, render, mode = exam.mode) {
  const questions = makeAttempt(exam.questions);
  Object.assign(exam, newExam(mode), { questions });
  render(true);
}

const optionLabel = (item, option) => (item.kind === "pictures" ? byId.get(option).title : option);
const pointsLabel = (points) => `${points} ${points === 1 ? "point" : "points"}`;

function isAnswered(exam, index) {
  return exam.answers[index]?.size === exam.questions[index].correct.length;
}

function answerWarning(required, selected) {
  if (selected < required) return "Complete this question before grading the quiz.";
  if (selected === required) return "";
  const extra = selected - required;
  return `Select ${required} answers. You selected ${selected}. Remove ${extra} ${extra === 1 ? "choice" : "choices"} before grading the quiz.`;
}

function submitExam(exam, { render, unlock }) {
  const missing = exam.questions.findIndex((_, index) => !isAnswered(exam, index));
  if (missing !== -1) {
    exam.index = missing;
    exam.checking = true;
    render(true);
    return;
  }
  const result = gradeQuiz(exam.questions, exam.answers);
  exam.result = result;
  render(true);
  if (result.passed) void unlock(result);
}

function quizFigure(entry, image, caption) {
  const illustration = node("figure", "wiki-exam-figure");
  illustration.append(image(entry, "wiki-detail-image"), node("figcaption", "wiki-muted", caption));
  return illustration;
}

/** The photo or diagram shown beside a question, if it has one. */
function questionVisual(item, image) {
  if (item.picture) {
    const figure = node("figure", "wiki-quiz-visual");
    figure.append(
      image(byId.get(item.picture), "wiki-quiz-photo"),
      node("figcaption", "wiki-muted", "AI-generated practice image."),
    );
    return figure;
  }
  if (item.diagram) {
    const figure = node("figure", "wiki-quiz-visual wiki-quiz-drawing");
    figure.append(drawDiagram(item.diagram));
    return figure;
  }
  return null;
}

function review(exam, open, image) {
  const rows = node("ol", "wiki-review");
  for (const [index, item] of exam.result.items.entries()) {
    const row = node("li");
    const toggle = node("details");
    const summary = node("summary");
    summary.append(node("span", null, item.prompt), node("span", "wiki-points", `${item.earned}/${item.points}`));
    const explanation = node("div", "wiki-explanation");
    const article = byId.get(item.article);
    const visual = byId.get(item.picture) ?? article;
    const selected = (indexes) =>
      [...indexes]
        .sort((a, b) => a - b)
        .map((choice) => optionLabel(item, item.options[choice]))
        .join(" · ");
    explanation.append(
      node("p", null, `Your answer — ${selected(item.selected)}`),
      node("p", null, `Correct answer — ${selected(item.correct)}`),
      node("p", "wiki-muted", item.explanation),
    );
    if (item.diagram && !item.picture) {
      const figure = node("figure", "wiki-exam-figure wiki-quiz-drawing");
      figure.append(drawDiagram(item.diagram));
      explanation.append(figure);
    } else if (visual.imageAlt) {
      const figure = quizFigure(visual, image, "AI-generated example of this print symptom.");
      figure.firstChild.loading = "lazy";
      explanation.append(figure, node("p", "wiki-muted", visual.check));
    }
    const read = button(`Read ${article.title}`, () => open(article, index), "wiki-button wiki-chip");
    read.dataset.wikiReviewArticle = String(index);
    explanation.append(read);
    toggle.append(summary, explanation);
    row.append(toggle);
    rows.append(row);
  }
  return rows;
}

export function updateAward(award, status) {
  const notice = award.querySelector("[role='status']");
  const retry = award.querySelector("button");
  const wasFocused = retry === award.ownerDocument.activeElement;
  retry.hidden = status !== "retry" && !(status === "pending" && !retry.hidden);
  retry.setAttribute("aria-disabled", String(status === "pending"));
  notice.textContent =
    {
      pending: "Checking the FDM Fundamentals achievement…",
      earned: "Achievement earned · FDM Fundamentals",
      retry: "The badge claim couldn’t be confirmed.",
    }[status] ?? "";
  award.hidden = !notice.textContent;
  if (wasFocused && retry.hidden && !award.hidden) notice.focus({ preventScroll: true });
}

/** Practice | Exam, as pressed buttons; `pick` gets the mode a button stands for. */
function modeControl(current, pick) {
  const group = node("div", "wiki-segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Quiz mode");
  for (const [mode, { label }] of Object.entries(quizModes)) {
    const choice = button(label, () => pick(mode), "wiki-segment");
    choice.dataset.mode = mode;
    choice.setAttribute("aria-pressed", String(mode === current));
    group.append(choice);
  }
  return group;
}

function startCard(exam, render) {
  const intro = node("div", "wiki-exam-card");
  const about = node("p", "wiki-muted");
  const begin = button("", () => start(exam, render), "wiki-button wiki-primary");
  const control = modeControl(exam.mode, (mode) => {
    exam.mode = mode;
    for (const choice of control.children) choice.setAttribute("aria-pressed", String(choice.dataset.mode === mode));
    describe();
  });
  function describe() {
    about.textContent = quizModes[exam.mode].about();
    begin.textContent = quizModes[exam.mode].start;
  }
  describe();
  intro.append(
    pageTitle(
      "FDM fundamentals quiz",
      "Practice choosing materials, reading print defects and preparing a part for the slicer.",
    ),
    control,
    about,
    begin,
  );
  return intro;
}

function resultCard(exam, { render, navigate, unlock }) {
  const completed = exam.result;
  const { score, passed } = completed;
  const percent = Math.round((score / totalPoints) * 100);
  const result = node("div", "wiki-exam-card");
  const controls = node("div", "wiki-actions");
  if (exam.mode === "practice") {
    result.append(
      pageTitle("Practice complete", `${score} of ${totalPoints} points · ${percent}%`),
      node("p", "wiki-muted", "Practice answers don’t count toward the badge."),
    );
    controls.append(
      button("Practice again", () => start(exam, render, "practice"), "wiki-button wiki-primary"),
      button("Take the exam", () => start(exam, render, "exam")),
    );
    result.append(controls);
    return result;
  }
  result.append(
    pageTitle(passed ? "Quiz passed" : "Quiz complete", `${score} of ${totalPoints} points · ${percent}%`),
    node(
      "p",
      "wiki-muted",
      passed
        ? "You reached the 80% pass mark."
        : `The pass mark is ${passingPoints} points. Review your answers below before trying another set.`,
    ),
  );
  if (passed) {
    const award = node("div", "wiki-award");
    award.dataset.wikiAward = "";
    const notice = node("p");
    notice.setAttribute("role", "status");
    notice.tabIndex = -1;
    const retry = button("Retry achievement", () => unlock(completed));
    retry.hidden = true;
    award.append(notice, retry);
    updateAward(award, exam.awardStatus);
    result.append(award);
  }
  controls.append(
    button("Try a new set", () => start(exam, render, "exam"), "wiki-button wiki-primary"),
    button("Browse guides", () => navigate("Guides")),
  );
  result.append(controls);
  return result;
}

function keyHints(...hints) {
  const line = node("p", "wiki-keys");
  hints.forEach(([keys, action], index) => {
    if (index) line.append(" · ");
    keys.forEach((key, at) => {
      if (at) line.append("–");
      line.append(node("kbd", null, key));
    });
    line.append(` ${action}`);
  });
  return line;
}

function questionCard(exam, actions) {
  const { open, render, image } = actions;
  const practice = exam.mode === "practice";
  const { index } = exam;
  const item = exam.questions[index];
  const multiple = item.correct.length > 1;
  const pictures = item.kind === "pictures";
  const selected = exam.answers[index] ?? new Set();
  exam.answers[index] = selected;
  const last = index === questionCount - 1;

  const card = node("div", "wiki-exam-card wiki-quiz-card");
  const top = node("div", "wiki-quiz-top");
  const chips = node("div", "wiki-quiz-chips");
  const confirm = node("div", "wiki-quiz-confirm");
  confirm.hidden = true;
  const control = modeControl(exam.mode, (mode) => {
    if (mode === exam.mode) return;
    const keep = button(practice ? "Keep practicing" : "Keep the exam", () => {
      confirm.hidden = true;
      control.querySelector(`[data-mode="${mode}"]`).focus();
    });
    const restart = button(
      `Start ${quizModes[mode].label.toLowerCase()} set`,
      () => start(exam, render, mode),
      "wiki-button wiki-primary",
    );
    confirm.replaceChildren(
      node("p", null, `Start a new ${quizModes[mode].label.toLowerCase()} set? This set’s answers will be cleared.`),
      restart,
      keep,
    );
    confirm.hidden = false;
    restart.focus();
  });
  top.append(control, chips);

  const meter = node("div", "wiki-meter");
  const fill = node("span");
  meter.append(fill);
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", String(questionCount));
  meter.setAttribute("aria-label", practice ? "Questions checked" : "Questions answered");

  function updateStatus() {
    const done = practice
      ? exam.checked.filter(Boolean).length
      : exam.questions.filter((_, at) => isAnswered(exam, at)).length;
    meter.setAttribute("aria-valuenow", String(done));
    fill.style.setProperty("--wiki-done", String(done / questionCount));
    const stats = [];
    if (practice) {
      let earned = 0;
      let possible = 0;
      exam.questions.forEach((question, at) => {
        if (!exam.checked[at]) return;
        earned += gradeItem(question, exam.answers[at]);
        possible += question.points;
      });
      if (possible) stats.push(node("span", "wiki-stat", `${earned} / ${possible} points`));
      if (exam.streak >= 2) {
        const streak = node("span", "wiki-stat wiki-streak");
        streak.append(flameIcon(), `${exam.streak} in a row`);
        stats.push(streak);
      }
    } else stats.push(node("span", "wiki-stat", `${done} of ${questionCount} answered`));
    chips.replaceChildren(...stats);
    if (warning) {
      warning.textContent = answerWarning(item.correct.length, selected.size);
      warning.hidden = !warning.textContent;
    }
  }

  const question = node("fieldset", "wiki-quiz-question");
  const legend = node("legend");
  const prompt = node("h1", "wiki-quiz-prompt", item.prompt);
  prompt.tabIndex = -1;
  legend.append(prompt);
  question.append(legend);
  const warning = !practice && exam.checking ? node("p", "wiki-notice") : null;
  warning?.setAttribute("role", "alert");
  if (warning) question.append(warning);

  const body = node("div", "wiki-quiz-body");
  const visual = questionVisual(item, image);
  if (visual) {
    body.classList.add("wiki-quiz-has-visual");
    body.append(visual);
  }
  const answers = node("div", "wiki-quiz-answers");
  const hintText = multiple ? `Select ${item.correct.length} answers.` : "Select one answer.";
  const hint = node("p", "wiki-muted wiki-quiz-hint", hintText);
  const choices = node("div", pictures ? "wiki-picks" : "wiki-tiles");
  const inputs = [];
  item.options.forEach((option, choice) => {
    const tile = node("label", pictures ? "wiki-pick" : "wiki-tile");
    const input = node("input", "wiki-tile-input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = "wiki-answer";
    input.checked = selected.has(choice);
    input.addEventListener("change", () => {
      if (!multiple) selected.clear();
      if (input.checked) selected.add(choice);
      else selected.delete(choice);
      if (hint.classList.contains("wiki-notice")) {
        hint.textContent = hintText;
        hint.classList.remove("wiki-notice");
        hint.removeAttribute("role");
      }
      updateStatus();
    });
    const key = node("span", "wiki-tile-key", String(choice + 1));
    key.setAttribute("aria-hidden", "true");
    const mark = node("span", "wiki-tile-mark");
    if (pictures) {
      const entry = byId.get(option);
      const photo = image(entry, "wiki-pick-photo");
      photo.alt = neutralAlts[option] ?? entry.imageAlt;
      const caption = node("span", "wiki-pick-caption", entry.title);
      caption.hidden = true;
      tile.append(input, node("span", "wiki-sr-only", `Picture ${choice + 1}.`), photo, key, caption, mark);
    } else tile.append(input, key, node("span", "wiki-tile-text", option), mark);
    choices.append(tile);
    inputs.push(input);
  });
  answers.append(hint, choices);
  body.append(answers);
  question.append(body);

  const footer = node("div", practice ? "wiki-quiz-footer" : "wiki-exam-controls");
  let primary;
  card.append(
    top,
    confirm,
    meter,
    node("p", "wiki-quiz-meta", `Question ${index + 1} of ${questionCount} · ${pointsLabel(item.points)}`),
    question,
  );

  function goTo(next) {
    exam.index = next;
    exam.checking = false;
    render(true);
  }

  if (practice) {
    const feedback = node("div", "wiki-feedback");
    feedback.hidden = true;
    feedback.tabIndex = -1;
    primary = button("Check", check, "wiki-button wiki-primary");
    footer.append(keyHints([["1", String(Math.min(4, item.options.length))], "choose"], [["Enter"], "check"]), primary);
    card.append(feedback, footer);

    function check() {
      if (selected.size !== item.correct.length) {
        hint.textContent = multiple ? `Select ${item.correct.length} answers first.` : "Select an answer first.";
        hint.classList.add("wiki-notice");
        hint.setAttribute("role", "alert");
        return;
      }
      exam.checked[index] = true;
      exam.streak = gradeItem(item, selected) ? exam.streak + 1 : 0;
      reveal(true);
    }

    function advance() {
      if (!last) return goTo(index + 1);
      exam.result = gradeQuiz(exam.questions, exam.answers);
      render(true);
    }

    function reveal(animate) {
      const earned = gradeItem(item, selected);
      inputs.forEach((input, choice) => {
        const tile = choices.children[choice];
        const right = item.correct.includes(choice);
        const chosen = selected.has(choice);
        input.disabled = true;
        tile.classList.add("wiki-locked");
        tile.classList.toggle("wiki-correct", right);
        tile.classList.toggle("wiki-wrong", chosen && !right);
        tile.querySelector(".wiki-tile-mark").textContent = right ? "Correct" : chosen ? "Your answer" : "";
        const caption = tile.querySelector(".wiki-pick-caption");
        if (caption) caption.hidden = false;
      });
      const article = byId.get(item.article);
      const read = button(`Read ${article.title} ↗`, () => open(article, "practice"), "wiki-button wiki-chip");
      read.dataset.wikiReviewArticle = "practice";
      feedback.replaceChildren(
        node("p", "wiki-feedback-title", earned ? `Correct · +${earned}` : "Not quite"),
        node("p", null, item.explanation),
        read,
      );
      feedback.className = ["wiki-feedback", earned ? "wiki-good" : "", animate ? "wiki-animate" : ""]
        .filter(Boolean)
        .join(" ");
      feedback.hidden = false;
      const next = button(last ? "See results" : "Continue →", advance, "wiki-button wiki-primary");
      primary.replaceWith(next);
      primary = next;
      footer.firstChild.replaceWith(keyHints([["Enter"], last ? "see results" : "continue"]));
      updateStatus();
      if (!animate) return;
      feedback.focus({ preventScroll: true });
      footer.scrollIntoView({ block: "nearest" });
    }

    if (exam.checked[index]) reveal(false);
  } else {
    const previous = button("← Previous", () => goTo(index - 1));
    previous.disabled = index === 0;
    primary =
      !last && !exam.checking
        ? button("Next →", () => goTo(index + 1), "wiki-button wiki-primary")
        : button("Grade quiz", () => submitExam(exam, actions), "wiki-button wiki-primary");
    footer.append(previous, primary);
    card.append(footer);
  }
  updateStatus();

  card.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (/^[1-9]$/.test(event.key)) {
      const input = inputs[Number(event.key) - 1];
      if (!input || input.disabled) return;
      event.preventDefault();
      input.click();
      input.focus();
    } else if (event.key === "Enter") {
      if (target.closest("button, a, summary, textarea, input[type='search'], input[type='text']")) return;
      event.preventDefault();
      primary.click();
    }
  });
  return card;
}

export function showExam(exam, actions) {
  const { open, render, image } = actions;
  const page = node("section", "wiki-flow wiki-exam");
  if (!exam.questions.length) page.append(startCard(exam, render));
  else if (exam.result)
    page.append(resultCard(exam, actions), node("h2", null, "Review answers"), review(exam, open, image));
  else page.append(questionCard(exam, actions));
  return page;
}
