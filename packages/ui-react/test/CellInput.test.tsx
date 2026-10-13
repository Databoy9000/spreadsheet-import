import { type CellError, ErrorSource } from "@spotable/spreadsheet-import-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CellInput } from "../src/CellInput.js";

const error = (level: CellError["level"] = "error"): CellError => ({
  message: "bad value",
  level,
  source: ErrorSource.Row,
});

describe("CellInput", () => {
  it("shows the current value", () => {
    render(<CellInput label="Name" value="Jan" error={null} onCommit={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Jan");
  });

  it("renders an absent value as empty rather than 'undefined'", () => {
    render(<CellInput label="Name" value={undefined} error={null} onCommit={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
  });

  it("does not commit while typing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CellInput label="Name" value="" error={null} onCommit={onCommit} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Jan");

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Jan");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits once on blur", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CellInput label="Name" value="" error={null} onCommit={onCommit} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Jan");
    await user.tab();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Jan");
  });

  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CellInput label="Name" value="" error={null} onCommit={onCommit} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Jan{Enter}");

    expect(onCommit).toHaveBeenCalledWith("Jan");
  });

  it("does not commit an unchanged value", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CellInput label="Name" value="Jan" error={null} onCommit={onCommit} />);

    await user.click(screen.getByRole("textbox", { name: "Name" }));
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("reverts the draft on Escape", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<CellInput label="Name" value="Jan" error={null} onCommit={onCommit} />);

    const input = screen.getByRole("textbox", { name: "Name" });
    await user.type(input, " typo{Escape}");

    expect(input).toHaveValue("Jan");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("marks error-level problems for assistive tech but not warnings", () => {
    const { rerender } = render(<CellInput label="Name" value="x" error={error("error")} onCommit={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");

    rerender(<CellInput label="Name" value="x" error={error("warning")} onCommit={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveAttribute("aria-invalid");
  });

  it("exposes the message as a tooltip", () => {
    render(<CellInput label="Name" value="x" error={error()} onCommit={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("title", "bad value");
  });

  it("picks up an external change when it is not focused", () => {
    const { rerender } = render(<CellInput label="Name" value="Jan" error={null} onCommit={vi.fn()} />);
    rerender(<CellInput label="Name" value="Rewritten by a hook" error={null} onCommit={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rewritten by a hook");
  });

  it("does not overwrite what someone is typing", async () => {
    const user = userEvent.setup();

    // A parent that re-renders with a different value mid-edit — exactly what a
    // tableHook or a revalidation of a neighbouring row can cause.
    function Harness() {
      const [external, setExternal] = useState("Jan");
      return (
        <>
          <CellInput label="Name" value={external} error={null} onCommit={vi.fn()} />
          <button onClick={() => setExternal("Server said Sofie")}>push</button>
        </>
      );
    }

    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Name" });

    await user.clear(input);
    await user.type(input, "Half-typed");
    // Fire the external update while the field still has focus.
    input.focus();
    screen.getByText("push").click();

    expect(input).toHaveValue("Half-typed");
  });
});
