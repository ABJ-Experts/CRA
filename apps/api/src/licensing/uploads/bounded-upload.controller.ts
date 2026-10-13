import { uploadPathSchema } from "@repo/contracts/licensing/schemas";
import type { UploadPath } from "@repo/contracts/licensing/types";
import { zodParams } from "../../common/pipes/zod-validation.pipe";
import { Controller, HttpCode, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../auth/auth.types";
import { NonJsonResponse } from "../../common/http/zod-response.interceptor";
import { BoundedUploadService } from "./bounded-upload.service";

/** The single-use token is a database-bound source grant, never a session substitute. */
@Controller("licensing/uploads")
export class BoundedUploadController {
  constructor(private readonly uploads: BoundedUploadService) {}

  @Put(":operationId/:token")
  @Public()
  @HttpCode(204)
  @NonJsonResponse("empty")
  async upload(
    @Param(zodParams(uploadPathSchema)) params: UploadPath,
    @Req() request: Request,
  ): Promise<void> {
    await this.uploads.accept(
      params.operationId,
      params.token,
      request.headers["content-length"],
      request,
    );
  }
}
