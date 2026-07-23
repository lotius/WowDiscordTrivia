import { z } from "zod";

const imageSchema = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    altText: z.string().min(1).optional()
  })
]);

export const questionSchema = z.object({
  type: z.enum(["text", "image"]),
  category: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  question: z.string().min(1),
  images: z.array(imageSchema).optional(),
  image: z.string().min(1).optional(),
  correctAnswer: z.string().min(1),
  acceptedAnswers: z.array(z.string().min(1)).optional().default([]),
  distractors: z.array(z.string().min(1)).max(20).optional().default([]),
  answers: z.array(z.string().min(1)).min(2).max(20).optional(),
  answerPool: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).max(30).optional().default([]),
  active: z.boolean().optional().default(true)
}).transform((question) => {
  const legacyDistractors = (question.answers ?? []).filter(
    (answer) => answer.toLocaleLowerCase() !== question.correctAnswer.toLocaleLowerCase()
  );
  return {
    ...question,
    images: [...(question.images ?? []), ...(question.image ? [question.image] : [])],
    distractors: [...new Set([...question.distractors, ...legacyDistractors])]
  };
}).superRefine((question, context) => {
  if (question.type === "image" && question.images.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["images"],
      message: "Image questions require at least one image path or URL."
    });
  }
});

export const libraryImportSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return { questions: value };
  return value;
}, z.object({
  source: z.string().optional(),
  defaultCategory: z.string().min(1).optional(),
  questions: z.array(z.unknown()).min(1)
}).transform((input, context) => {
  const questions = input.questions.map((raw, index) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("category" in raw) &&
      input.defaultCategory
    ) {
      raw = { ...raw, category: input.defaultCategory };
    }
    const result = questionSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          ...issue,
          path: ["questions", index, ...issue.path]
        });
      }
      return null;
    }
    return result.data;
  }).filter((question) => question !== null);

  return { source: input.source, questions };
}));
