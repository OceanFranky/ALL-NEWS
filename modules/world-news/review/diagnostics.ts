import { z } from 'zod';

export function reviewErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    const details = error.issues.slice(0, 5).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return `Review input has ${error.issues.length} invalid fields. First five: ${details}`;
  }
  return error instanceof Error ? error.message.slice(0, 500) : 'Review operation failed';
}
