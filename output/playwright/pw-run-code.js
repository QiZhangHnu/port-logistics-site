async (page) => {
  const result = await page.evaluate(async () => {
    try {
      await import('/assets/js/teacher-learning-analytics-page.js?v=debug2');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        toString: String(error),
      };
    }
  });
  return result;
}
