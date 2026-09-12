/** Comparator order is best first; storage is bounded independently of input size. */
export class DocumentTopK<T> {
  private readonly rows: T[] = [];
  constructor(readonly capacity: number, private readonly compare: (a: T, b: T) => number) {}
  get size(): number { return this.rows.length; }
  offer(row: T): void {
    if (this.rows.length < this.capacity) {
      this.rows.push(row);
      let child = this.rows.length - 1;
      while (child > 0) {
        const parent = (child - 1) >> 1;
        if (this.compare(this.rows[child]!, this.rows[parent]!) <= 0) break;
        [this.rows[child], this.rows[parent]] = [this.rows[parent]!, this.rows[child]!];
        child = parent;
      }
      return;
    }
    if (!this.capacity || this.compare(row, this.rows[0]!) >= 0) return;
    this.rows[0] = row;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1, right = left + 1;
      let worst = parent;
      if (left < this.rows.length && this.compare(this.rows[left]!, this.rows[worst]!) > 0) worst = left;
      if (right < this.rows.length && this.compare(this.rows[right]!, this.rows[worst]!) > 0) worst = right;
      if (worst === parent) break;
      [this.rows[parent], this.rows[worst]] = [this.rows[worst]!, this.rows[parent]!];
      parent = worst;
    }
  }
  sorted(): T[] { return [...this.rows].sort(this.compare); }
}
