export class DependencyCheckDto {
  status!: 'up';
  latencyMs!: number;
}

export class HealthChecksDto {
  database!: DependencyCheckDto;
}

export class HealthResponseDto {
  status!: 'ok';
  version!: string;
  uptimeSeconds!: number;
  timestamp!: Date;
  checks!: HealthChecksDto;
}
