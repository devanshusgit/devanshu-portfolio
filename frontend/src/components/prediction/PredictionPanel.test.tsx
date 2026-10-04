import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PredictionResult } from "@/api/types";
import { PredictionPanel } from "./PredictionPanel";

function result(confidence: number, uncertain: boolean): PredictionResult {
  const probabilities = { Glass: confidence, Steel: 1 - confidence, Plastic: 0, Wood: 0, Rubber: 0, Fabric: 0 };
  return {
    id: 1,
    persisted: true,
    timestamp: "2026-01-01T00:00:00Z",
    data_source: "UPLOADED",
    source_detail: null,
    sample: { pressure: 1, temperature: 1, vibration: 1, conductivity: 1, contact_duration: 1 },
    ground_truth: "Glass",
    correct: true,
    dataset_ref: null,
    prediction: {
      material: "Glass",
      display_label: uncertain ? "Uncertain" : "Glass",
      is_uncertain: uncertain,
      confidence,
      confidence_level: confidence >= 0.8 ? "HIGH" : confidence >= 0.6 ? "MODERATE" : "LOW",
      probabilities,
      ranking: [],
      out_of_distribution: [],
    },
    grip: {} as PredictionResult["grip"],
    command: {} as PredictionResult["command"],
    model_version: "v",
    trace: [],
    latency_ms: 1,
  };
}

describe("PredictionPanel", () => {
  it("renders the model's actual confidence", () => {
    render(<PredictionPanel result={result(0.9961, false)} />);
    expect(screen.getByTestId("predicted-material")).toHaveTextContent("Glass");
    expect(screen.getByTestId("prediction-confidence")).toHaveTextContent("99.6%");
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("never presents a low-confidence prediction as reliable", () => {
    render(<PredictionPanel result={result(0.52, true)} />);
    expect(screen.getByTestId("predicted-material")).toHaveTextContent("Uncertain");
    expect(screen.getByText(/LOW · UNCERTAIN/)).toBeInTheDocument();
    expect(screen.getByText(/not trusted/)).toBeInTheDocument();
  });

  it("shows an empty state before any prediction", () => {
    render(<PredictionPanel result={null} />);
    expect(screen.getByText("No prediction yet")).toBeInTheDocument();
  });
});
