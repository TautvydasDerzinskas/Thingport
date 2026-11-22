import { byId } from "./articles.js";
import { gradeQuiz, makeAttempt, passingPoints, questionBank, questionCount, totalPoints } from "./quiz.js";
import { button, node, pageTitle } from "./ui.js";

export function newExam() {
  return { questions: [], answers: [], index: 0, result: null, earned: false, message: "" };
}

function start(exam, render) {
  const questions = makeAttempt(exam.questions);
  Object.assign(exam, newExam(), { questions });
  render(true);
}

function isAnswered(exam, index) {
  return exam.answers[index]?.size === exam.questions[index].correct.length;
}

function submitExam(exam, { render, unlock }) {
  const missing = exam.questions.findIndex((_, index) => !isAnswered(exam, index));
  if (missing !== -1) {
    exam.index = missing;
    exam.message = "Complete this question before grading the quiz.";
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

function review(exam, open, image) {
  const rows = node("ol", "wiki-review");
  for (const item of exam.result.items) {
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
        .map((index) => item.options[index])
        .join(" · ");
    explanation.append(
      node("p", null, `Your answer — ${selected(item.selected)}`),
      node("p", null, `Correct answer — ${selected(item.correct)}`),
      node("p", "wiki-muted", item.explanation),
    );
    if (visual.imageAlt) {
      const figure = quizFigure(visual, image, "AI-generated example of this print symptom.");
      figure.firstChild.loading = "lazy";
      explanation.append(figure, node("p", "wiki-muted", visual.check));
    }
    explanation.append(button(`Read ${article.title}`, () => open(article), "wiki-button wiki-chip"));
    toggle.append(summary, explanation);
    row.append(toggle);
    rows.append(row);
  }
  return rows;
}

export function showExam(exam, actions) {
  const { open, render, navigate, image } = actions;
  const page = node("section", "wiki-flow wiki-exam");
  if (!exam.questions.length) {
    const intro = node("div", "wiki-exam-card");
    intro.append(
      pageTitle(
        "FDM fundamentals quiz",
        "Practice choosing materials, reading print defects and preparing a part for the slicer.",
      ),
      node(
        "p",
        null,
        `Each attempt draws ${questionCount} questions from a bank of ${questionBank.length}, including four illustrated diagnosis questions. Questions are worth 1, 2 or 3 points. Multi-select questions require both correct choices.`,
      ),
      node("p", "wiki-muted", `Pass with at least ${passingPoints} of ${totalPoints} points (80%).`),
      button("Start quiz", () => start(exam, render), "wiki-button wiki-primary"),
    );
    page.append(intro);
    return page;
  }

  if (exam.result) {
    const { score, passed } = exam.result;
    const award = node("p", "wiki-award", exam.earned ? "Achievement earned · FDM Fundamentals" : "");
    award.dataset.wikiAward = "";
    award.setAttribute("aria-live", "polite");
    const controls = node("div", "wiki-actions");
    controls.append(
      button("Try a new set", () => start(exam, render), "wiki-button wiki-primary"),
      button("Browse guides", () => navigate("Guides")),
    );
    const result = node("div", "wiki-exam-card");
    result.append(
      pageTitle(
        passed ? "Quiz passed" : "Quiz complete",
        `${score} of ${totalPoints} points · ${Math.round((score / totalPoints) * 100)}%`,
      ),
      node(
        "p",
        "wiki-muted",
        passed
          ? "You reached the 80% pass mark."
          : `The pass mark is ${passingPoints} points. Review your answers below before trying another set.`,
      ),
      award,
      controls,
    );
    page.append(result, node("h2", null, "Review answers"), review(exam, open, image));
    return page;
  }

  const { index } = exam;
  const item = exam.questions[index];
  const multiple = item.correct.length > 1;
  const selected = exam.answers[index] ?? new Set();
  const panel = node("div", "wiki-exam-card");
  const meta = node("div", "wiki-question-status");
  const progress = node("progress", "wiki-progress");
  progress.max = questionCount;
  progress.setAttribute("aria-label", "Questions answered");
  const progressText = node("span", "wiki-muted");
  function updateProgress() {
    const count = exam.questions.filter((_, questionIndex) => isAnswered(exam, questionIndex)).length;
    progress.value = count;
    progressText.textContent = `${count} of ${questionCount} answered`;
  }
  updateProgress();
  meta.append(progressText, node("span", "wiki-points", `${item.points} ${item.points === 1 ? "point" : "points"}`));
  panel.append(pageTitle(`Question ${index + 1} of ${questionCount}`), meta, progress);
  const options = node("fieldset", "wiki-options");
  options.append(node("legend", null, item.prompt));
  if (item.picture) options.append(quizFigure(byId.get(item.picture), image, "AI-generated practice image."));
  options.append(node("p", "wiki-muted", multiple ? `Select ${item.correct.length} answers.` : "Select one answer."));
  item.options.forEach((answer, choice) => {
    const row = node("label", "wiki-option");
    const input = node("input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = "wiki-answer";
    input.checked = selected.has(choice);
    input.addEventListener("change", () => {
      if (multiple) {
        if (input.checked) selected.add(choice);
        else selected.delete(choice);
        exam.answers[index] = selected;
      } else exam.answers[index] = new Set([choice]);
      updateProgress();
    });
    row.append(input, node("span", null, answer));
    options.append(row);
  });

  function goTo(next) {
    exam.index = next;
    exam.message = "";
    render(true);
  }

  const controls = node("div", "wiki-exam-controls");
  const previous = button("← Previous", () => goTo(index - 1));
  previous.disabled = index === 0;
  controls.append(previous);
  if (index < questionCount - 1 && !exam.message) {
    controls.append(button("Next →", () => goTo(index + 1), "wiki-button wiki-primary"));
  } else {
    controls.append(button("Grade quiz", () => submitExam(exam, actions), "wiki-button wiki-primary"));
  }
  panel.append(options);
  if (exam.message) {
    const warning = node("p", "wiki-notice", exam.message);
    warning.setAttribute("role", "alert");
    panel.append(warning);
  }
  panel.append(controls);
  page.append(panel);
  return page;
}
