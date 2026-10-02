import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateImportDto {
  /** A public CSV link or a Google Sheets link (shared "Anyone with the link"). */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  url!: string;

  /** Validate and preview without writing. Defaults to true; send `false` to apply. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = true;

  /**
   * Optional, when applying: the id of the dry run you reviewed. The apply is refused
   * (409 IMPORT_SOURCE_CHANGED) if the link no longer serves the same file.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  previewId?: string;
}
