import { describe, expect, it } from "vitest";
import { parseScheduleInput } from "@/lib/schedule-input";

const body = {
  date: "2026-10-05",
  plate: "V1",
  requestIds: ["r1", "r2"],
  legs: [
    {
      origin: "Somewhere else",
      destinationId: "d1",
      plannedTimeOut: "08:15",
      plannedTimeIn: "09:00",
      contactName: "  Ana  ",
      contactNumber: "",
      stops: ["rd1", "rd2"],
    },
    { isFinal: true, destinationId: "d9", plannedTimeOut: "09:30", plannedTimeIn: "10:30", stops: [] },
  ],
};

describe("parseScheduleInput", () => {
  it("keeps the fields the RPC needs and drops client origins", () => {
    const input = parseScheduleInput(body);
    expect(input).toEqual({
      date: "2026-10-05",
      plate: "V1",
      requestIds: ["r1", "r2"],
      legs: [
        { destinationId: "d1", plannedTimeOut: "08:15", plannedTimeIn: "09:00", contactName: "Ana", contactNumber: "", stops: ["rd1", "rd2"], isFinal: false },
        { destinationId: undefined, plannedTimeOut: "09:30", plannedTimeIn: "10:30", contactName: "", contactNumber: "", stops: [], isFinal: true },
      ],
    });
    expect(input?.legs[0]).not.toHaveProperty("origin");
  });

  it("leaves time and route rules to the server", () => {
    const input = parseScheduleInput({ ...body, legs: [{ destinationId: "d1", plannedTimeOut: "", plannedTimeIn: "7pm" }] });
    expect(input?.legs[0]).toMatchObject({ plannedTimeOut: "", plannedTimeIn: "7pm", stops: [] });
  });

  it("rejects bodies that aren't usable", () => {
    expect(parseScheduleInput(null)).toBeNull();
    expect(parseScheduleInput({ ...body, date: "05/10/2026" })).toBeNull();
    expect(parseScheduleInput({ ...body, plate: "" })).toBeNull();
    expect(parseScheduleInput({ ...body, requestIds: "r1" })).toBeNull();
    expect(parseScheduleInput({ ...body, requestIds: [1] })).toBeNull();
    expect(parseScheduleInput({ ...body, legs: undefined })).toBeNull();
    expect(parseScheduleInput({ ...body, legs: ["leg"] })).toBeNull();
    expect(parseScheduleInput({ ...body, legs: [{ destinationId: "d1", stops: [""] }] })).toBeNull();
  });
});
