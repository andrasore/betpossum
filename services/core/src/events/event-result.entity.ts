import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type EventOutcome = 'home' | 'away' | 'draw';

@Entity('event_results')
export class EventResult {
  @PrimaryColumn({ name: 'event_id' })
  eventId!: string;

  @Column({ type: 'varchar' })
  outcome!: EventOutcome;

  @CreateDateColumn({ name: 'resolved_at' })
  resolvedAt!: Date;
}
