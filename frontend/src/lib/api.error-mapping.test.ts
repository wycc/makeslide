import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, mapApiErrorToHumanMessage } from "./api";

test("mapApiErrorToHumanMessage maps known code", () => {
  const msg = mapApiErrorToHumanMessage(new ApiError("x", "FILE_TOO_LARGE", 413));
  assert.equal(msg.title, "檔案太大");
});

test("mapApiErrorToHumanMessage fallback unknown code", () => {
  const msg = mapApiErrorToHumanMessage(new ApiError("raw", "SOMETHING_NEW", 400));
  assert.equal(msg.message, "raw");
});

test("mapApiErrorToHumanMessage maps INVALID_REQUEST to a friendly message instead of the raw backend text", () => {
  const msg = mapApiErrorToHumanMessage(new ApiError("Invalid body", "INVALID_REQUEST", 400));
  assert.equal(msg.title, "請求格式不正確");
  assert.notEqual(msg.message, "Invalid body");
  assert.ok(msg.nextStep);
});

test("mapApiErrorToHumanMessage maps the generic NOT_FOUND code to a friendly message", () => {
  const msg = mapApiErrorToHumanMessage(new ApiError("PDF not found", "NOT_FOUND", 404));
  assert.equal(msg.title, "找不到資源");
  assert.notEqual(msg.message, "PDF not found");
  assert.ok(msg.nextStep);
});

test("mapApiErrorToHumanMessage falls back to a generic message for any *_NOT_FOUND code", () => {
  const quiz = mapApiErrorToHumanMessage(new ApiError("Quiz 5 not found", "QUIZ_NOT_FOUND", 404));
  assert.equal(quiz.title, "找不到資源");
  assert.notEqual(quiz.message, "Quiz 5 not found");

  const figure = mapApiErrorToHumanMessage(new ApiError("Figure not found", "FIGURE_NOT_FOUND", 404));
  assert.equal(figure.title, "找不到資源");
});

test("mapApiErrorToHumanMessage prefers a dedicated hint over the *_NOT_FOUND fallback", () => {
  const pdf = mapApiErrorToHumanMessage(new ApiError("PDF not found", "PDF_NOT_FOUND", 404));
  assert.equal(pdf.title, "找不到簡報資料");
});

test("mapApiErrorToHumanMessage maps poppler/dependency issues", () => {
  const poppler = mapApiErrorToHumanMessage(new ApiError("x", "POPPLER_NOT_FOUND", 500));
  assert.equal(poppler.title, "PDF 解析工具缺失");

  const dep = mapApiErrorToHumanMessage(new ApiError("x", "DEPENDENCY_MISSING", 500));
  assert.equal(dep.title, "系統依賴缺失");
});
