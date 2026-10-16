import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { httpMaintenance } from "./http-maintenance";
import { mountedMaintenanceGate } from "./maintenance-gate";
jest.mock("./maintenance-gate", () => ({ mountedMaintenanceGate: jest.fn() }));
it("retains the lease after disconnect until positive response completion", () => {
  const release = jest.fn();
  jest
    .mocked(mountedMaintenanceGate)
    .mockReturnValue({ enter: () => release } as unknown as ReturnType<
      typeof mountedMaintenanceGate
    >);
  const response = new EventEmitter();
  const next = jest.fn();
  httpMaintenance({} as Request, response as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  response.emit("close");
  expect(release).not.toHaveBeenCalled();
  response.emit("finish");
  expect(release).toHaveBeenCalledTimes(1);
});
it("refuses requests before handlers when closed", () => {
  jest
    .mocked(mountedMaintenanceGate)
    .mockReturnValue({ enter: () => null } as unknown as ReturnType<
      typeof mountedMaintenanceGate
    >);
  const response = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    end: jest.fn(),
  };
  const next = jest.fn();
  httpMaintenance({} as Request, response as unknown as Response, next);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.end).toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
it("allows only the two exact read-only internal health probes", () => {
  const next = jest.fn();
  for (const path of ["/api/v1/health", "/api/v1/health/ready"])
    httpMaintenance({ method: "GET", path } as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(2);
  const response = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    end: jest.fn(),
  };
  for (const request of [
    { method: "GET", path: "/api/v1/auth/refresh" },
    { method: "POST", path: "/api/v1/health" },
    { method: "GET", path: "/api/v1/health/ready/extra" },
  ])
    httpMaintenance(request as Request, response as unknown as Response, next);
  expect(next).toHaveBeenCalledTimes(2);
  expect(response.status).toHaveBeenCalledTimes(3);
});
