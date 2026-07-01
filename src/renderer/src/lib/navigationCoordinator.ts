/**
 * Keeps independent sequence counters for primary-screen navigation and the
 * read-only link preview. A slow preview request must never cancel a page,
 * Journal, or database navigation request (and vice versa).
 */
export class NavigationCoordinator {
  private primarySequence = 0;
  private previewSequence = 0;

  beginPrimary(): number {
    this.primarySequence += 1;
    return this.primarySequence;
  }

  invalidatePrimary(): void {
    this.primarySequence += 1;
  }

  isPrimaryCurrent(sequence: number): boolean {
    return sequence === this.primarySequence;
  }

  beginPreview(): number {
    this.previewSequence += 1;
    return this.previewSequence;
  }

  invalidatePreview(): void {
    this.previewSequence += 1;
  }

  isPreviewCurrent(sequence: number): boolean {
    return sequence === this.previewSequence;
  }
}
