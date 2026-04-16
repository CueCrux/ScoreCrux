export interface Record {
  id: number;
  name: string;
  category: string;
  value: number;
}

export type Stage = (records: Record[]) => Record[];

export class Pipeline {
  private stages: Stage[] = [];

  addStage(stage: Stage): this {
    this.stages.push(stage);
    return this;
  }

  run(records: Record[]): Record[] {
    let result = [...records];
    for (const stage of this.stages) {
      result = stage(result);
    }
    return result;
  }
}

export function doubleValues(records: Record[]): Record[] {
  return records.map((r) => ({ ...r, value: r.value * 2 }));
}
