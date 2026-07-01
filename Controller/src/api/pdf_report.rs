use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::Json as AxumJson;
use printpdf::{
    BuiltinFont, Color, Line, LinePoint, Mm, Op, PdfDocument, PdfFontHandle, PdfPage,
    PdfSaveOptions, Point, Pt, Rgb, TextItem,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::server::Error;
use crate::api::statistics::{
    get_statistics, get_time_statistics, Params, StatisticsApi, TimeStatisticsApi,
};
use crate::core::traffic_gen_core::types::{Rfc2544PortMapping, Rfc2544Results};
use crate::AppState;

const PAGE_W: f64 = 210.0;
const PAGE_H: f64 = 297.0;
const MARGIN: f64 = 14.0;
const LINE_H: f64 = 5.2;
const FRAME_LOSS_TABLE_STEPS: [u32; 10] = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
const FRAME_LOSS_GRAPH_STEPS: [u32; 11] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct P4tgReportRequest {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tester: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub test_location: String,
    #[serde(default)]
    pub dut_name: String,
    #[serde(default)]
    pub dut_vendor: String,
    #[serde(default)]
    pub dut_model: String,
    #[serde(default)]
    pub dut_software_version: String,
    #[serde(default)]
    pub dut_configuration: String,
    #[serde(default)]
    pub media_type: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub data_stream_format: String,
    #[serde(default)]
    pub notes: String,
}

impl P4tgReportRequest {
    fn normalize(mut self) -> Self {
        self.title = normalize_meta(self.title, "P4TG Test Report");
        self.tester = normalize_meta(self.tester, "n/a");
        self.organization = normalize_meta(self.organization, "n/a");
        self.test_location = normalize_meta(self.test_location, "n/a");
        self.dut_name = normalize_meta(self.dut_name, "n/a");
        self.dut_vendor = normalize_meta(self.dut_vendor, "n/a");
        self.dut_model = normalize_meta(self.dut_model, "n/a");
        self.dut_software_version = normalize_meta(self.dut_software_version, "n/a");
        self.dut_configuration = normalize_meta(self.dut_configuration, "n/a");
        self.media_type = normalize_meta(self.media_type, "n/a");
        self.protocol = normalize_meta(self.protocol, "n/a");
        self.data_stream_format = normalize_meta(self.data_stream_format, "n/a");
        self.notes = normalize_meta(self.notes, "n/a");
        self
    }
}

struct ReportInput {
    stats: Vec<StatisticsApi>,
    time_stats: Vec<TimeStatisticsApi>,
    metadata: P4tgReportRequest,
    exported_at: String,
}

struct PdfReport {
    doc: PdfDocument,
    ops: Vec<Op>,
    y: f64,
}

#[utoipa::path(
    post,
    path = "/api/report",
    request_body = P4tgReportRequest,
    responses(
        (status = 200, description = "Returns a PDF report with P4TG statistics and RFC2544 results when available.", content_type = "application/pdf"),
        (status = 400, description = "No statistics are available.", body = Error),
        (status = 500, description = "Failed to generate the report.", body = Error)
    )
)]
pub async fn p4tg_report(
    State(state): State<Arc<AppState>>,
    AxumJson(metadata): AxumJson<P4tgReportRequest>,
) -> Response {
    report_response(state, metadata).await
}

async fn report_response(state: Arc<AppState>, metadata: P4tgReportRequest) -> Response {
    let stats = get_statistics(&state).await;
    let time_stats = get_time_statistics(&state, Params { limit: None }).await;
    if !has_report_data(&stats, &time_stats) {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new("No statistics available for report export.")),
        )
            .into_response();
    }

    let exported_at = unix_timestamp_string();
    let filename = format!("p4tg_report_{exported_at}.pdf");
    let input = ReportInput {
        stats,
        time_stats,
        metadata: metadata.normalize(),
        exported_at,
    };

    match build_pdf(input) {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/pdf"),
            );
            headers.insert(
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                    .unwrap_or_else(|_| {
                        HeaderValue::from_static("attachment; filename=\"p4tg_report.pdf\"")
                    }),
            );
            (StatusCode::OK, headers, bytes).into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!(
                "Failed to generate P4TG PDF report: {err}"
            ))),
        )
            .into_response(),
    }
}

fn has_report_data(stats: &[StatisticsApi], time_stats: &[TimeStatisticsApi]) -> bool {
    stats.iter().any(has_statistics_content) || time_stats.iter().any(has_time_statistics_content)
}

fn has_statistics_content(stats: &StatisticsApi) -> bool {
    stats.rfc2544.is_some()
        || !stats.frame_size.is_empty()
        || !stats.tx_rate_l1.is_empty()
        || !stats.rx_rate_l1.is_empty()
        || !stats.frame_type_data.is_empty()
        || !stats.iats.is_empty()
        || !stats.rtts.is_empty()
        || !stats.packet_loss.is_empty()
        || !stats.out_of_order.is_empty()
}

fn has_time_statistics_content(time_stats: &TimeStatisticsApi) -> bool {
    !time_stats.tx_rate_l1.is_empty()
        || !time_stats.rx_rate_l1.is_empty()
        || !time_stats.packet_loss.is_empty()
        || !time_stats.out_of_order.is_empty()
        || !time_stats.rtt.is_empty()
}

fn build_pdf(input: ReportInput) -> Result<Vec<u8>, String> {
    let mut pdf = PdfReport {
        doc: PdfDocument::new(&input.metadata.title),
        ops: Vec::new(),
        y: PAGE_H - MARGIN,
    };

    write_cover(&mut pdf, &input);
    if input.stats.iter().any(|entry| entry.rfc2544.is_some()) {
        for entry in input.stats.iter().filter(|entry| entry.rfc2544.is_some()) {
            let rfc = entry.rfc2544.as_ref().unwrap();
            pdf.new_page();
            pdf.heading(&format!(
                "RFC2544 Results{}",
                entry
                    .name
                    .as_ref()
                    .map(|name| format!(" - {name}"))
                    .unwrap_or_default()
            ));
            write_rfc_summary(&mut pdf, rfc);
            write_throughput(&mut pdf, rfc);
            write_latency(&mut pdf, rfc);
            write_frame_loss(&mut pdf, rfc);
            write_system_recovery(&mut pdf, rfc);
            write_reset(&mut pdf, rfc);
            write_limitations(&mut pdf, rfc);
        }
    } else {
        for entry in &input.stats {
            write_p4tg_additional(
                &mut pdf,
                entry,
                matching_time_stats(entry, &input.time_stats),
            );
        }
    }

    pdf.finish_page();
    Ok(pdf.doc.save(&PdfSaveOptions::default(), &mut Vec::new()))
}

fn write_cover(pdf: &mut PdfReport, input: &ReportInput) {
    pdf.heading(&input.metadata.title);
    pdf.text(&format!("Export timestamp: {}", input.exported_at));
    pdf.space(4.0);
    pdf.subheading("Report Metadata");
    pdf.key_values(&[
        ("Tester", &input.metadata.tester),
        ("Organization", &input.metadata.organization),
        ("Test location", &input.metadata.test_location),
        ("DUT name", &input.metadata.dut_name),
        ("DUT vendor", &input.metadata.dut_vendor),
        ("DUT model", &input.metadata.dut_model),
        ("DUT software version", &input.metadata.dut_software_version),
        ("DUT configuration", &input.metadata.dut_configuration),
        ("Media type", &input.metadata.media_type),
        ("Protocol", &input.metadata.protocol),
        ("Data stream format", &input.metadata.data_stream_format),
        ("Notes", &input.metadata.notes),
    ]);
    pdf.space(4.0);
    pdf.text(
        "This report is generated by the P4TG controller from /statistics and /time_statistics.",
    );
    let rfc_count = input
        .stats
        .iter()
        .filter(|entry| entry.rfc2544.is_some())
        .count();
    pdf.key_values(&[
        (
            "Report type",
            if rfc_count > 0 {
                "RFC2544 benchmark"
            } else {
                "General P4TG statistics"
            },
        ),
        ("Statistics entries", &input.stats.len().to_string()),
        (
            "Time-statistics entries",
            &input.time_stats.len().to_string(),
        ),
        (
            "RFC2544 entries",
            &if rfc_count == 0 {
                "none".to_string()
            } else {
                rfc_count.to_string()
            },
        ),
    ]);
}

fn write_rfc_summary(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    pdf.subheading("Benchmark Summary");
    let tests = [
        (rfc.throughput_selected, "Throughput"),
        (rfc.latency_selected, "Latency"),
        (rfc.frame_loss_selected, "Frame loss"),
        (rfc.reset_selected, "Reset"),
        (rfc.system_recovery_selected, "System recovery"),
    ]
    .iter()
    .filter_map(|(selected, label)| selected.then_some(*label))
    .collect::<Vec<_>>()
    .join(", ");
    pdf.key_values(&[
        ("Status", &rfc.status),
        ("Selected tests", &tests),
        (
            "Frame sizes",
            &rfc.selected_frame_sizes
                .iter()
                .map(|v| format!("{v} B"))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        ("Line rate", &format!("{:.3} Gbit/s", rfc.line_rate_gbps)),
        (
            "Mappings",
            &rfc.selected_mappings
                .iter()
                .map(mapping_label)
                .collect::<Vec<_>>()
                .join(", "),
        ),
    ]);
}

fn write_throughput(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    if rfc.throughput.is_empty() {
        return;
    }
    pdf.new_page();
    pdf.heading("RFC2544 Throughput");
    pdf.text("RFC2544 reports throughput as a graph with frame size on the X axis and frame rate on the Y axis.");
    let mut series = Vec::new();
    series.push(ChartSeries {
        label: "Theoretical media rate".to_string(),
        points: rfc
            .selected_frame_sizes
            .iter()
            .map(|frame| {
                (
                    *frame as f64,
                    gbps_to_mpps(rfc.line_rate_gbps as f64, *frame),
                )
            })
            .collect(),
        color: (0.0, 0.35, 0.75),
    });
    for mapping in throughput_mappings(rfc) {
        series.push(ChartSeries {
            label: format!("Measured {}", mapping_label(&mapping)),
            points: rfc
                .selected_frame_sizes
                .iter()
                .filter_map(|frame| {
                    rfc.throughput
                        .iter()
                        .find(|row| {
                            row.frame_size == *frame && same_mapping(&row.mapping, &mapping)
                        })
                        .map(|row| (*frame as f64, gbps_to_mpps(row.zero_loss_rate_gbps, *frame)))
                })
                .collect(),
            color: next_color(series.len()),
        });
    }
    pdf.line_chart(
        "Throughput",
        "Frame size (bytes)",
        "Frame rate (Mpps)",
        &series,
        110.0,
        60.0,
    );
    let include_aggregation = rfc
        .throughput
        .iter()
        .any(|row| row.repetition_count > 1 || row.repetitions.len() > 1);
    let mut headers = vec!["Mapping", "Frame", "ZLT", "Mpps", "First loss", "Lost"];
    if include_aggregation {
        headers.extend(["Aggregation", "Reps"]);
    }
    pdf.table(
        &headers,
        rfc.throughput
            .iter()
            .map(|row| {
                let mut cells = vec![
                    mapping_label(&row.mapping),
                    format!("{} B", row.frame_size),
                    format_gbps(row.zero_loss_rate_gbps),
                    format!(
                        "{:.3}",
                        gbps_to_mpps(row.zero_loss_rate_gbps, row.frame_size)
                    ),
                    row.first_loss_rate_gbps
                        .map(format_gbps)
                        .unwrap_or_else(|| "-".to_string()),
                    row.lost_frames.to_string(),
                ];
                if include_aggregation {
                    cells.push(format!("{:?}", row.aggregation));
                    cells.push(row.repetition_count.to_string());
                }
                cells
            })
            .collect(),
    );
    let repetition_rows = rfc
        .throughput
        .iter()
        .flat_map(|row| {
            row.repetitions
                .iter()
                .filter(move |_| row.repetitions.len() > 1)
                .map(move |rep| {
                    vec![
                        mapping_label(&row.mapping),
                        format!("{} B", row.frame_size),
                        rep.repetition.to_string(),
                        format_gbps(rep.zero_loss_rate_gbps),
                        rep.first_loss_rate_gbps
                            .map(format_gbps)
                            .unwrap_or_else(|| "-".to_string()),
                        rep.lost_frames.to_string(),
                    ]
                })
        })
        .collect::<Vec<_>>();
    if !repetition_rows.is_empty() {
        pdf.subheading("ZLT Repetition Details");
        pdf.table(
            &["Mapping", "Frame", "Rep.", "ZLT", "First loss", "Lost"],
            repetition_rows,
        );
    }
}

fn write_latency(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    if rfc.latency.is_empty() {
        return;
    }
    pdf.new_page();
    pdf.heading("RFC2544 Latency");
    pdf.text("P4TG reports latency as sampled RTT/2 values; this is not an exact RFC tagged-frame timestamp measurement.");
    pdf.table(
        &[
            "Mapping", "Frame", "Rate", "Mean", "Min", "Max", "Jitter", "Samples",
        ],
        rfc.latency
            .iter()
            .map(|row| {
                vec![
                    mapping_label(&row.mapping),
                    format!("{} B", row.frame_size),
                    format_gbps(row.rate_gbps),
                    format!("{:.2} ns", row.mean_latency_ns),
                    format!("{} ns", row.min_latency_ns),
                    format!("{} ns", row.max_latency_ns),
                    format!("{:.2} ns", row.jitter_ns),
                    row.samples.to_string(),
                ]
            })
            .collect(),
    );
}

fn write_frame_loss(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    if rfc.frame_loss.is_empty() {
        return;
    }
    pdf.new_page();
    pdf.heading("RFC2544 Frame Loss Rate");
    let series = frame_loss_series_keys(rfc)
        .iter()
        .enumerate()
        .map(|(index, (mapping, frame_size))| ChartSeries {
            label: format!("{}, {} B", mapping_label(mapping), frame_size),
            points: FRAME_LOSS_GRAPH_STEPS
                .iter()
                .filter_map(|offered_percent| {
                    let offered_rate_gbps =
                        rfc.line_rate_gbps as f64 * *offered_percent as f64 / 100.0;
                    let x = gbps_to_mpps(offered_rate_gbps, *frame_size);
                    if *offered_percent == 0 {
                        Some((x, 0.0))
                    } else {
                        rfc.frame_loss
                            .iter()
                            .find(|row| {
                                row.frame_size == *frame_size
                                    && row.offered_percent == *offered_percent
                                    && same_mapping(&row.mapping, mapping)
                            })
                            .map(|row| (x, row.loss_percentage))
                    }
                })
                .collect(),
            color: next_color(index),
        })
        .collect::<Vec<_>>();
    pdf.line_chart(
        "Frame Loss Rate",
        "Offered rate (Mpps)",
        "Frame loss (%)",
        &series,
        110.0,
        60.0,
    );
    pdf.table(&frame_loss_table_headers(), frame_loss_table_rows(rfc));
}

fn write_system_recovery(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    if rfc.system_recovery.is_empty() {
        return;
    }
    pdf.new_page();
    pdf.heading("RFC2544 System Recovery");
    pdf.text("Recovery timing is controller-observed; the coarse 1s sampling interval can affect the reported recovery time.");
    pdf.table(
        &[
            "Mapping",
            "Frame",
            "Throughput",
            "Overload",
            "Recovery",
            "Time",
            "Lost after reduction",
            "Status",
        ],
        rfc.system_recovery
            .iter()
            .map(|row| {
                vec![
                    mapping_label(&row.mapping),
                    format!("{} B", row.frame_size),
                    format_gbps(row.throughput_rate_gbps),
                    format_gbps(row.overload_rate_gbps),
                    format_gbps(row.recovery_rate_gbps),
                    row.recovery_time_ms
                        .map(|v| format!("{v:.2} ms"))
                        .unwrap_or_else(|| "-".to_string()),
                    row.lost_frames_after_reduction.to_string(),
                    format!(
                        "{} - {}",
                        if row.recovered {
                            "Recovered"
                        } else {
                            "Not confirmed"
                        },
                        row.status
                    ),
                ]
            })
            .collect(),
    );
}

fn write_reset(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    if rfc.reset.is_empty() {
        return;
    }
    pdf.new_page();
    pdf.heading("RFC2544 Reset");
    for row in &rfc.reset {
        pdf.text(&format!(
            "{} with {} B frames at {}: {} ({})",
            mapping_label(&row.mapping),
            row.frame_size,
            format_gbps(row.rate_gbps),
            row.reset_time_ms
                .map(|v| format!("{v:.2} ms"))
                .unwrap_or_else(|| "not measured".to_string()),
            row.status
        ));
    }
}

fn write_p4tg_additional(
    pdf: &mut PdfReport,
    stats: &StatisticsApi,
    time_stats: Option<&TimeStatisticsApi>,
) {
    pdf.new_page();
    pdf.heading(&format!(
        "P4TG Statistics{}",
        stats
            .name
            .as_ref()
            .map(|name| format!(" - {name}"))
            .unwrap_or_default()
    ));
    let sample_mode = if stats.sample_mode {
        "enabled"
    } else {
        "disabled"
    };
    let elapsed_time = format!("{} s", stats.elapsed_time);
    pdf.key_values(&[
        ("Sample mode", sample_mode),
        ("Elapsed time", &elapsed_time),
    ]);
    if let Some(time_stats) = time_stats {
        let rate_series = aggregate_rate_series(time_stats);
        if !rate_series.is_empty() {
            pdf.line_chart(
                "TX/RX Rate",
                "Time (s)",
                "Gbit/s",
                &rate_series,
                110.0,
                55.0,
            );
        }
        let loss_series = aggregate_counter_series(time_stats);
        if !loss_series.is_empty() {
            pdf.line_chart(
                "Packet Loss / Out-of-order",
                "Time (s)",
                "Frames",
                &loss_series,
                110.0,
                55.0,
            );
        }
    }

    pdf.subheading("Final Rate And Counter Summary");
    let rate_rows = final_rate_rows(stats);
    if rate_rows.is_empty() {
        pdf.text("No final rate or counter rows available.");
    } else {
        pdf.table(
            &[
                "Port",
                "TX L1",
                "RX L1",
                "TX L2",
                "RX L2",
                "Loss",
                "Out-of-order",
            ],
            rate_rows,
        );
    }

    pdf.subheading("Aggregate Counter Summary");
    pdf.table(
        &["Metric", "Value"],
        vec![
            vec![
                "Packet loss".to_string(),
                nested_u64_sum(&stats.packet_loss).to_string(),
            ],
            vec![
                "Out-of-order".to_string(),
                nested_u64_sum(&stats.out_of_order).to_string(),
            ],
            vec![
                "RTT samples".to_string(),
                stats
                    .rtts
                    .values()
                    .flat_map(|m| m.values())
                    .map(|r| r.n)
                    .sum::<u32>()
                    .to_string(),
            ],
            vec![
                "IAT samples".to_string(),
                stats
                    .iats
                    .values()
                    .flat_map(|m| m.values())
                    .map(|i| i.tx.n + i.rx.n)
                    .sum::<u32>()
                    .to_string(),
            ],
        ],
    );

    let frame_size_rows = frame_size_rows(stats);
    if !frame_size_rows.is_empty() {
        pdf.subheading("Frame Size Distribution");
        pdf.table(&["Port", "Path", "Range", "Packets"], frame_size_rows);
    }

    let frame_type_rows = frame_type_rows(stats);
    if !frame_type_rows.is_empty() {
        pdf.subheading("Frame Type Distribution");
        pdf.table(&["Port", "Path", "Type", "Packets"], frame_type_rows);
    }

    let rtt_rows = rtt_rows(stats);
    if !rtt_rows.is_empty() {
        pdf.subheading("RTT Summary");
        pdf.table(
            &["Port", "Mean", "Min", "Max", "Current", "Jitter", "Samples"],
            rtt_rows,
        );
    }

    let iat_rows = iat_rows(stats);
    if !iat_rows.is_empty() {
        pdf.subheading("IAT Summary");
        pdf.table(&["Port", "Path", "Mean", "Std/MAE", "Samples"], iat_rows);
    }

    let histogram_rows = histogram_rows(stats);
    if !histogram_rows.is_empty() {
        pdf.subheading("Histogram Summary");
        pdf.table(
            &[
                "Type", "Port", "Path", "Mean", "Std dev", "Packets", "Missed",
            ],
            histogram_rows,
        );
    }
}

fn write_limitations(pdf: &mut PdfReport, rfc: &Rfc2544Results) {
    pdf.new_page();
    pdf.heading("Limitations and Deviations");
    let mut notes = vec![
        "Back-to-back and address-caching tests are not included because they require data-plane changes.".to_string(),
        "Reset and system-recovery timings are controller-observed.".to_string(),
    ];
    if rfc.throughput.iter().any(|row| row.repetition_count > 1) {
        notes.push("Repeated or clustered zero-loss-throughput aggregation is a P4TG robustness extension for noisy DUTs.".to_string());
    }
    if rfc.system_recovery_selected {
        notes.push("System recovery uses sampled loss counters; precision is bounded by the sampling interval.".to_string());
    }
    for note in notes {
        pdf.bullet(&note);
    }
}

impl PdfReport {
    fn finish_page(&mut self) {
        if self.ops.is_empty() {
            return;
        }
        let ops = std::mem::take(&mut self.ops);
        self.doc
            .pages
            .push(PdfPage::new(mm(PAGE_W), mm(PAGE_H), ops));
    }

    fn new_page(&mut self) {
        self.finish_page();
        self.y = PAGE_H - MARGIN;
    }

    fn ensure_space(&mut self, needed: f64) {
        if self.y - needed < MARGIN {
            self.new_page();
        }
    }

    fn heading(&mut self, text: &str) {
        self.ensure_space(14.0);
        self.write_text(text, 16.0, MARGIN, self.y, BuiltinFont::HelveticaBold);
        self.y -= 9.0;
    }

    fn subheading(&mut self, text: &str) {
        self.ensure_space(9.0);
        self.write_text(text, 11.0, MARGIN, self.y, BuiltinFont::HelveticaBold);
        self.y -= 6.5;
    }

    fn text(&mut self, text: &str) {
        for line in wrap_text(text, 105) {
            self.ensure_space(LINE_H);
            self.write_text(&line, 8.5, MARGIN, self.y, BuiltinFont::Helvetica);
            self.y -= LINE_H;
        }
    }

    fn bullet(&mut self, text: &str) {
        self.text(&format!("- {text}"));
    }

    fn space(&mut self, amount: f64) {
        self.y -= amount;
    }

    fn key_values(&mut self, rows: &[(&str, &str)]) {
        for (key, value) in rows {
            self.ensure_space(LINE_H);
            self.write_text(
                &format!("{key}:"),
                8.5,
                MARGIN,
                self.y,
                BuiltinFont::HelveticaBold,
            );
            self.write_text(value, 8.5, MARGIN + 42.0, self.y, BuiltinFont::Helvetica);
            self.y -= LINE_H;
        }
    }

    fn table<S: AsRef<str>>(&mut self, headers: &[S], rows: Vec<Vec<String>>) {
        if rows.is_empty() {
            self.text("No rows available.");
            return;
        }
        let width = (PAGE_W - 2.0 * MARGIN) / headers.len() as f64;
        let chars_per_col = ((width / 1.7).floor() as usize).max(4);
        let header_lines = headers
            .iter()
            .map(|header| wrap_table_cell(header.as_ref(), chars_per_col))
            .collect::<Vec<_>>();
        let header_height = table_row_height(&header_lines, 4.0);
        self.ensure_space(header_height);
        self.write_table_row(&header_lines, width, 7.0, BuiltinFont::HelveticaBold);
        self.y -= header_height;

        for row in rows {
            let cell_lines = (0..headers.len())
                .map(|index| {
                    row.get(index)
                        .map(|cell| wrap_table_cell(cell, chars_per_col))
                        .unwrap_or_else(|| vec!["".to_string()])
                })
                .collect::<Vec<_>>();
            let row_height = table_row_height(&cell_lines, 3.8);
            self.ensure_space(row_height);
            self.write_table_row(&cell_lines, width, 6.3, BuiltinFont::Helvetica);
            self.y -= row_height;
        }
        self.y -= 2.0;
    }

    fn write_table_row(
        &mut self,
        columns: &[Vec<String>],
        width: f64,
        size: f64,
        font: BuiltinFont,
    ) {
        for (index, lines) in columns.iter().enumerate() {
            let x = MARGIN + index as f64 * width;
            for (line_index, line) in lines.iter().enumerate() {
                self.write_text(line, size, x, self.y - line_index as f64 * 3.8, font);
            }
        }
    }

    fn line_chart(
        &mut self,
        title: &str,
        x_label: &str,
        y_label: &str,
        series: &[ChartSeries],
        width: f64,
        height: f64,
    ) {
        if series.iter().all(|s| s.points.is_empty()) {
            return;
        }
        self.ensure_space(height + 30.0);
        self.subheading(title);
        let x = MARGIN + 12.0;
        let y = self.y - height;
        let all_points = series
            .iter()
            .flat_map(|s| s.points.iter())
            .copied()
            .collect::<Vec<_>>();
        let (min_x, max_x) = min_max(all_points.iter().map(|p| p.0)).unwrap_or((0.0, 1.0));
        let (_, max_y) = min_max(all_points.iter().map(|p| p.1)).unwrap_or((0.0, 1.0));
        let max_y = if max_y <= 0.0 { 1.0 } else { max_y * 1.1 };
        self.stroke_line(x, y, x, y + height, (0.0, 0.0, 0.0), 0.4);
        self.stroke_line(x, y, x + width, y, (0.0, 0.0, 0.0), 0.4);
        for step in 0..=4 {
            let ratio = step as f64 / 4.0;
            let gx = x + width * ratio;
            let gy = y + height * ratio;
            let x_value = if (max_x - min_x).abs() < f64::EPSILON {
                min_x
            } else {
                min_x + (max_x - min_x) * ratio
            };
            let y_value = max_y * ratio;

            if step > 0 {
                self.stroke_line(x, gy, x + width, gy, (0.85, 0.85, 0.85), 0.2);
            }
            if step > 0 && step < 4 {
                self.stroke_line(gx, y, gx, y + height, (0.90, 0.90, 0.90), 0.15);
            }
            self.stroke_line(gx, y, gx, y - 1.5, (0.0, 0.0, 0.0), 0.25);
            self.stroke_line(x - 1.5, gy, x, gy, (0.0, 0.0, 0.0), 0.25);
            self.write_text(
                &format_chart_tick(x_value),
                5.3,
                gx - 5.0,
                y - 4.8,
                BuiltinFont::Helvetica,
            );
            self.write_text(
                &format_chart_tick(y_value),
                5.3,
                x - 13.0,
                gy - 1.5,
                BuiltinFont::Helvetica,
            );
        }
        for s in series {
            let points = s
                .points
                .iter()
                .map(|(px, py)| {
                    let scaled_x = if (max_x - min_x).abs() < f64::EPSILON {
                        x + width / 2.0
                    } else {
                        x + ((*px - min_x) / (max_x - min_x)) * width
                    };
                    let scaled_y = y + (*py / max_y) * height;
                    (scaled_x, scaled_y)
                })
                .collect::<Vec<_>>();
            self.polyline(&points, s.color, 0.8);
            if points.len() == 1 {
                self.point_marker(points[0].0, points[0].1, s.color);
            }
        }
        self.write_text(
            x_label,
            6.5,
            x + width / 3.0,
            y - 10.0,
            BuiltinFont::Helvetica,
        );
        self.write_text(
            y_label,
            6.5,
            x - 12.0,
            y + height + 3.0,
            BuiltinFont::Helvetica,
        );
        let mut legend_y = y + height - 4.0;
        for s in series.iter().take(7) {
            self.stroke_line(
                x + width + 4.0,
                legend_y,
                x + width + 10.0,
                legend_y,
                s.color,
                0.8,
            );
            self.write_text(
                &truncate(&s.label, 34),
                6.0,
                x + width + 12.0,
                legend_y - 1.5,
                BuiltinFont::Helvetica,
            );
            legend_y -= 5.0;
        }
        self.y = y - 12.0;
    }

    fn write_text(&mut self, text: &str, size: f64, x: f64, y: f64, font: BuiltinFont) {
        self.ops.push(Op::StartTextSection);
        self.ops.push(Op::SetTextCursor {
            pos: Point::new(mm(x), mm(y)),
        });
        self.ops.push(Op::SetFont {
            font: PdfFontHandle::Builtin(font),
            size: Pt(size as f32),
        });
        self.ops.push(Op::SetLineHeight {
            lh: Pt(size as f32),
        });
        self.ops.push(Op::SetFillColor {
            col: Color::Rgb(rgb(0.0, 0.0, 0.0)),
        });
        self.ops.push(Op::ShowText {
            items: vec![TextItem::Text(sanitize(text))],
        });
        self.ops.push(Op::EndTextSection);
    }

    fn stroke_line(
        &mut self,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        color: (f64, f64, f64),
        width: f64,
    ) {
        self.ops.push(Op::SetOutlineColor {
            col: Color::Rgb(rgb(color.0, color.1, color.2)),
        });
        self.ops.push(Op::SetOutlineThickness {
            pt: Pt(width as f32),
        });
        self.ops.push(Op::DrawLine {
            line: Line {
                points: vec![line_point(x1, y1), line_point(x2, y2)],
                is_closed: false,
            },
        });
    }

    fn polyline(&mut self, points: &[(f64, f64)], color: (f64, f64, f64), width: f64) {
        if points.len() < 2 {
            return;
        }
        self.ops.push(Op::SetOutlineColor {
            col: Color::Rgb(rgb(color.0, color.1, color.2)),
        });
        self.ops.push(Op::SetOutlineThickness {
            pt: Pt(width as f32),
        });
        self.ops.push(Op::DrawLine {
            line: Line {
                points: points.iter().map(|(x, y)| line_point(*x, *y)).collect(),
                is_closed: false,
            },
        });
    }

    fn point_marker(&mut self, x: f64, y: f64, color: (f64, f64, f64)) {
        let size = 1.4;
        self.stroke_line(x - size, y - size, x + size, y + size, color, 0.8);
        self.stroke_line(x - size, y + size, x + size, y - size, color, 0.8);
    }
}

struct ChartSeries {
    label: String,
    points: Vec<(f64, f64)>,
    color: (f64, f64, f64),
}

fn normalize_meta(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn mm(value: f64) -> Mm {
    Mm(value as f32)
}

fn rgb(r: f64, g: f64, b: f64) -> Rgb {
    Rgb::new(r as f32, g as f32, b as f32, None)
}

fn line_point(x: f64, y: f64) -> LinePoint {
    LinePoint {
        p: Point::new(mm(x), mm(y)),
        bezier: false,
    }
}

fn sanitize(text: &str) -> String {
    text.replace('→', "->")
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!(
            "{}...",
            text.chars().take(max.saturating_sub(3)).collect::<String>()
        )
    }
}

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if !current.is_empty() && current.len() + word.len() + 1 > width {
            lines.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn wrap_table_cell(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for chunk in text.split_whitespace() {
        push_wrapped_chunk(&mut lines, chunk, width);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn push_wrapped_chunk(lines: &mut Vec<String>, chunk: &str, width: usize) {
    if chunk.chars().count() > width {
        if lines.last().is_some_and(|line| !line.is_empty()) {
            lines.push(String::new());
        }
        let chars = chunk.chars().collect::<Vec<_>>();
        for part in chars.chunks(width) {
            lines.push(part.iter().collect());
        }
        return;
    }

    match lines.last_mut() {
        Some(last)
            if !last.is_empty() && last.chars().count() + 1 + chunk.chars().count() <= width =>
        {
            last.push(' ');
            last.push_str(chunk);
        }
        Some(last) if last.is_empty() => last.push_str(chunk),
        _ => lines.push(chunk.to_string()),
    }
}

fn table_row_height(columns: &[Vec<String>], line_height: f64) -> f64 {
    let lines = columns.iter().map(Vec::len).max().unwrap_or(1).max(1);
    lines as f64 * line_height + 1.0
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown_time".to_string())
}

fn mapping_label(mapping: &Rfc2544PortMapping) -> String {
    format!(
        "{}/{} -> {}/{}",
        mapping.tx_port, mapping.tx_channel, mapping.rx_port, mapping.rx_channel
    )
}

fn same_mapping(left: &Rfc2544PortMapping, right: &Rfc2544PortMapping) -> bool {
    left.tx_port == right.tx_port
        && left.tx_channel == right.tx_channel
        && left.rx_port == right.rx_port
        && left.rx_channel == right.rx_channel
}

fn throughput_mappings(rfc: &Rfc2544Results) -> Vec<Rfc2544PortMapping> {
    let mut mappings = Vec::new();
    for row in &rfc.throughput {
        if !mappings
            .iter()
            .any(|mapping| same_mapping(mapping, &row.mapping))
        {
            mappings.push(row.mapping.clone());
        }
    }
    mappings
}

fn frame_loss_series_keys(rfc: &Rfc2544Results) -> Vec<(Rfc2544PortMapping, u32)> {
    let mut keys = Vec::new();
    for row in &rfc.frame_loss {
        if !keys.iter().any(|(mapping, frame_size)| {
            row.frame_size == *frame_size && same_mapping(mapping, &row.mapping)
        }) {
            keys.push((row.mapping.clone(), row.frame_size));
        }
    }
    keys.sort_by_key(|(mapping, frame_size)| {
        (
            mapping.tx_port,
            mapping.tx_channel,
            mapping.rx_port,
            mapping.rx_channel,
            *frame_size,
        )
    });
    keys
}

fn frame_loss_table_headers() -> Vec<String> {
    let mut headers = vec!["Mapping".to_string(), "Frame".to_string()];
    headers.extend(
        FRAME_LOSS_TABLE_STEPS
            .iter()
            .map(|offered_percent| format!("{offered_percent}%")),
    );
    headers
}

fn frame_loss_table_rows(rfc: &Rfc2544Results) -> Vec<Vec<String>> {
    frame_loss_series_keys(rfc)
        .into_iter()
        .map(|(mapping, frame_size)| {
            let mut row = vec![mapping_label(&mapping), format!("{frame_size} B")];
            row.extend(FRAME_LOSS_TABLE_STEPS.iter().map(|offered_percent| {
                rfc.frame_loss
                    .iter()
                    .find(|entry| {
                        entry.frame_size == frame_size
                            && entry.offered_percent == *offered_percent
                            && same_mapping(&entry.mapping, &mapping)
                    })
                    .map(|entry| compact_percent(entry.loss_percentage))
                    .unwrap_or_else(|| "-".to_string())
            }));
            row
        })
        .collect()
}

fn gbps_to_mpps(gbps: f64, frame_size: u32) -> f64 {
    gbps * 1_000.0 / ((frame_size + 20) as f64 * 8.0)
}

fn format_gbps(gbps: f64) -> String {
    format!("{gbps:.3} Gbit/s")
}

fn compact_percent(value: f64) -> String {
    if value.abs() < 0.000_001 {
        "0%".to_string()
    } else if value.abs() < 1.0 {
        format!("{value:.3}%")
    } else {
        format!("{value:.2}%")
    }
}

fn format_chart_tick(value: f64) -> String {
    let value = if value.abs() < 0.000_001 { 0.0 } else { value };
    let abs = value.abs();
    if abs >= 1_000_000.0 {
        format!("{:.1}M", value / 1_000_000.0)
    } else if abs >= 1_000.0 {
        format!("{:.1}K", value / 1_000.0)
    } else if abs >= 100.0 || value.fract().abs() < 0.000_001 {
        format!("{value:.0}")
    } else if abs >= 10.0 {
        format!("{value:.1}")
    } else {
        format!("{value:.2}")
    }
}

fn next_color(index: usize) -> (f64, f64, f64) {
    const COLORS: [(f64, f64, f64); 7] = [
        (0.85, 0.20, 0.16),
        (0.18, 0.65, 0.33),
        (0.55, 0.35, 0.80),
        (0.95, 0.60, 0.10),
        (0.10, 0.65, 0.70),
        (0.55, 0.55, 0.15),
        (0.35, 0.35, 0.35),
    ];
    COLORS[index % COLORS.len()]
}

fn port_label(port: u32, channel: u8) -> String {
    format!("{port}/{channel}")
}

fn final_rate_rows(stats: &StatisticsApi) -> Vec<Vec<String>> {
    let mut ports = Vec::new();
    collect_ports_f64(&stats.tx_rate_l1, &mut ports);
    collect_ports_f64(&stats.rx_rate_l1, &mut ports);
    collect_ports_f64(&stats.tx_rate_l2, &mut ports);
    collect_ports_f64(&stats.rx_rate_l2, &mut ports);
    collect_ports_u64(&stats.packet_loss, &mut ports);
    collect_ports_u64(&stats.out_of_order, &mut ports);
    ports.sort_unstable();
    ports.dedup();

    ports
        .into_iter()
        .map(|(port, channel)| {
            vec![
                port_label(port, channel),
                format_optional_gbps(nested_f64_get(&stats.tx_rate_l1, port, channel)),
                format_optional_gbps(nested_f64_get(&stats.rx_rate_l1, port, channel)),
                format_optional_gbps(nested_f64_get(&stats.tx_rate_l2, port, channel)),
                format_optional_gbps(nested_f64_get(&stats.rx_rate_l2, port, channel)),
                nested_u64_get(&stats.packet_loss, port, channel)
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                nested_u64_get(&stats.out_of_order, port, channel)
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
            ]
        })
        .collect()
}

fn frame_size_rows(stats: &StatisticsApi) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut ports = stats.frame_size.iter().collect::<Vec<_>>();
    ports.sort_by_key(|(port, _)| **port);
    for (port, channels) in ports {
        let mut channels = channels.iter().collect::<Vec<_>>();
        channels.sort_by_key(|(channel, _)| **channel);
        for (channel, ranges) in channels {
            for value in &ranges.tx {
                rows.push(vec![
                    port_label(*port, *channel),
                    "TX".to_string(),
                    range_label(value.low, value.high),
                    value.packets.to_string(),
                ]);
            }
            for value in &ranges.rx {
                rows.push(vec![
                    port_label(*port, *channel),
                    "RX".to_string(),
                    range_label(value.low, value.high),
                    value.packets.to_string(),
                ]);
            }
        }
    }
    rows
}

fn frame_type_rows(stats: &StatisticsApi) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut ports = stats.frame_type_data.iter().collect::<Vec<_>>();
    ports.sort_by_key(|(port, _)| **port);
    for (port, channels) in ports {
        let mut channels = channels.iter().collect::<Vec<_>>();
        channels.sort_by_key(|(channel, _)| **channel);
        for (channel, types) in channels {
            let mut tx = types.tx.iter().collect::<Vec<_>>();
            tx.sort_by_key(|(name, _)| *name);
            for (name, packets) in tx {
                rows.push(vec![
                    port_label(*port, *channel),
                    "TX".to_string(),
                    name.clone(),
                    packets.to_string(),
                ]);
            }
            let mut rx = types.rx.iter().collect::<Vec<_>>();
            rx.sort_by_key(|(name, _)| *name);
            for (name, packets) in rx {
                rows.push(vec![
                    port_label(*port, *channel),
                    "RX".to_string(),
                    name.clone(),
                    packets.to_string(),
                ]);
            }
        }
    }
    rows
}

fn rtt_rows(stats: &StatisticsApi) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut ports = stats.rtts.iter().collect::<Vec<_>>();
    ports.sort_by_key(|(port, _)| **port);
    for (port, channels) in ports {
        let mut channels = channels.iter().collect::<Vec<_>>();
        channels.sort_by_key(|(channel, _)| **channel);
        for (channel, rtt) in channels {
            rows.push(vec![
                port_label(*port, *channel),
                format!("{:.2} ns", rtt.mean),
                format!("{} ns", rtt.min),
                format!("{} ns", rtt.max),
                format!("{} ns", rtt.current),
                format!("{:.2} ns", rtt.jitter),
                rtt.n.to_string(),
            ]);
        }
    }
    rows
}

fn iat_rows(stats: &StatisticsApi) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut ports = stats.iats.iter().collect::<Vec<_>>();
    ports.sort_by_key(|(port, _)| **port);
    for (port, channels) in ports {
        let mut channels = channels.iter().collect::<Vec<_>>();
        channels.sort_by_key(|(channel, _)| **channel);
        for (channel, iat) in channels {
            rows.push(iat_row(*port, *channel, "TX", &iat.tx));
            rows.push(iat_row(*port, *channel, "RX", &iat.rx));
        }
    }
    rows
}

fn iat_row(
    port: u32,
    channel: u8,
    path: &str,
    values: &crate::core::statistics::IATValues,
) -> Vec<String> {
    vec![
        port_label(port, channel),
        path.to_string(),
        format!("{:.2} ns", values.mean),
        values
            .std
            .map(|std| format!("std {:.2}", std))
            .unwrap_or_else(|| format!("mae {:.2}", values.mae)),
        values.n.to_string(),
    ]
}

fn histogram_rows(stats: &StatisticsApi) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    append_histogram_rows("RTT", &stats.rtt_histogram, &mut rows);
    append_histogram_rows("IAT", &stats.iat_histogram, &mut rows);
    rows
}

fn append_histogram_rows(
    histogram_type: &str,
    histograms: &std::collections::HashMap<
        u32,
        std::collections::HashMap<u8, crate::core::statistics::Histogram>,
    >,
    rows: &mut Vec<Vec<String>>,
) {
    let mut ports = histograms.iter().collect::<Vec<_>>();
    ports.sort_by_key(|(port, _)| **port);
    for (port, channels) in ports {
        let mut channels = channels.iter().collect::<Vec<_>>();
        channels.sort_by_key(|(channel, _)| **channel);
        for (channel, histogram) in channels {
            rows.push(histogram_row(
                histogram_type,
                *port,
                *channel,
                "TX",
                &histogram.data.tx,
            ));
            rows.push(histogram_row(
                histogram_type,
                *port,
                *channel,
                "RX",
                &histogram.data.rx,
            ));
        }
    }
}

fn histogram_row(
    histogram_type: &str,
    port: u32,
    channel: u8,
    path: &str,
    data: &crate::core::statistics::HistogramData,
) -> Vec<String> {
    vec![
        histogram_type.to_string(),
        port_label(port, channel),
        path.to_string(),
        format!("{:.2}", data.mean),
        format!("{:.2}", data.std_dev),
        data.total_pkt_count.to_string(),
        data.missed_bin_count.to_string(),
    ]
}

fn collect_ports_f64(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, f64>>,
    ports: &mut Vec<(u32, u8)>,
) {
    for (port, channels) in data {
        for channel in channels.keys() {
            ports.push((*port, *channel));
        }
    }
}

fn collect_ports_u64(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, u64>>,
    ports: &mut Vec<(u32, u8)>,
) {
    for (port, channels) in data {
        for channel in channels.keys() {
            ports.push((*port, *channel));
        }
    }
}

fn nested_f64_get(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, f64>>,
    port: u32,
    channel: u8,
) -> Option<f64> {
    data.get(&port)
        .and_then(|channels| channels.get(&channel))
        .copied()
}

fn nested_u64_get(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, u64>>,
    port: u32,
    channel: u8,
) -> Option<u64> {
    data.get(&port)
        .and_then(|channels| channels.get(&channel))
        .copied()
}

fn format_optional_gbps(value: Option<f64>) -> String {
    value
        .map(|value| format!("{value:.3} Gbit/s"))
        .unwrap_or_else(|| "-".to_string())
}

fn range_label(low: u32, high: u32) -> String {
    if low == high {
        format!("{low} B")
    } else {
        format!("{low}-{high} B")
    }
}

fn min_max(values: impl Iterator<Item = f64>) -> Option<(f64, f64)> {
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for value in values.filter(|value| value.is_finite()) {
        min = min.min(value);
        max = max.max(value);
    }
    min.is_finite().then_some((min, max))
}

fn matching_time_stats<'a>(
    stats: &StatisticsApi,
    time_stats: &'a [TimeStatisticsApi],
) -> Option<&'a TimeStatisticsApi> {
    time_stats
        .iter()
        .find(|entry| entry.name == stats.name)
        .or_else(|| time_stats.first())
}

fn aggregate_rate_series(time_stats: &TimeStatisticsApi) -> Vec<ChartSeries> {
    vec![
        ChartSeries {
            label: "TX L1".to_string(),
            points: aggregate_f64_series(&time_stats.tx_rate_l1),
            color: (0.0, 0.35, 0.75),
        },
        ChartSeries {
            label: "RX L1".to_string(),
            points: aggregate_f64_series(&time_stats.rx_rate_l1),
            color: (0.85, 0.20, 0.16),
        },
    ]
    .into_iter()
    .filter(|series| !series.points.is_empty())
    .collect()
}

fn aggregate_counter_series(time_stats: &TimeStatisticsApi) -> Vec<ChartSeries> {
    vec![
        ChartSeries {
            label: "Packet loss".to_string(),
            points: aggregate_u64_series(&time_stats.packet_loss),
            color: (0.85, 0.20, 0.16),
        },
        ChartSeries {
            label: "Out-of-order".to_string(),
            points: aggregate_u64_series(&time_stats.out_of_order),
            color: (0.55, 0.35, 0.80),
        },
    ]
    .into_iter()
    .filter(|series| !series.points.is_empty())
    .collect()
}

fn aggregate_f64_series(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, BTreeMap<u32, f64>>>,
) -> Vec<(f64, f64)> {
    let mut values: BTreeMap<u32, f64> = BTreeMap::new();
    for per_channel in data.values() {
        for samples in per_channel.values() {
            for (time, value) in samples {
                *values.entry(*time).or_default() += *value;
            }
        }
    }
    values
        .into_iter()
        .map(|(time, value)| (time as f64, value))
        .collect()
}

fn aggregate_u64_series(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, BTreeMap<u32, u64>>>,
) -> Vec<(f64, f64)> {
    let mut values: BTreeMap<u32, f64> = BTreeMap::new();
    for per_channel in data.values() {
        for samples in per_channel.values() {
            for (time, value) in samples {
                *values.entry(*time).or_default() += *value as f64;
            }
        }
    }
    values
        .into_iter()
        .map(|(time, value)| (time as f64, value))
        .collect()
}

fn nested_u64_sum(
    data: &std::collections::HashMap<u32, std::collections::HashMap<u8, u64>>,
) -> u64 {
    data.values().flat_map(|channels| channels.values()).sum()
}
