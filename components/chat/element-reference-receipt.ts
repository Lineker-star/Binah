export function shouldClearDraftElementReference(
  response: Response,
  sentSelectionVersion: number,
  currentSelectionVersion: number | undefined,
): boolean {
  return (
    response.ok &&
    response.headers.get('X-Binah-Element-Reference-Accepted') === '1' &&
    currentSelectionVersion === sentSelectionVersion
  );
}
