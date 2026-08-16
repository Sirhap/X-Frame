let meta = #{
    name: "xsxb-mcp-tool-audit",
    description: "Run each XSXB MCP tool in isolation and report whether it is fully usable",
    when_to_use: "When checking if XSXB MCP tools are production-ready",
    phases: [
        #{ title: "Run", detail: "live per-tool harness" },
        #{ title: "Judge", detail: "confirm limited and stub gaps from source" },
        #{ title: "Report", detail: "write the usability table" },
    ],
};

let audit_schema = #{
    "type": "object",
    "properties": #{
        "ready": #{ "type": "integer" },
        "limited": #{ "type": "integer" },
        "stub": #{ "type": "integer" },
        "fail": #{ "type": "integer" },
        "report": #{ "type": "string" },
    },
};
let judge_schema = #{
    "type": "object",
    "properties": #{
        "agreed": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
    },
};

let tuner_root = "/Volumes/other/IdeaProjects/sirhao/3D-images-tools/XSXB-Frame-Tuner";
if args != () && args.tuner_root != () {
    tuner_root = args.tuner_root;
}

phase("Run");
log("Running isolated probes for every xsxb_* MCP tool");
let run_prompt = "You are auditing XSXB MCP tool usability.";
run_prompt += " Working directory: " + tuner_root + ".";
run_prompt += " Run this exact command with the run_terminal_command tool:";
run_prompt += " node tools/xsxb_mcp_tool_usability.js";
run_prompt += " Do not skip the command. Do not summarize from memory.";
run_prompt += " After it finishes, set ready/limited/stub/fail from the first summary line";
run_prompt += " and put the full markdown table in report.";
run_prompt += " If the command fails, still fill report with the stderr and set fail to 1.";
let ran = agent(run_prompt, #{
    label: "harness",
    capability_mode: "execute",
    output_schema: audit_schema,
});

let report_text = "";
if ran != () && ran.success && ran.output != () && ran.output.report != () {
    report_text = ran.output.report;
}
if report_text == "" {
    report_text = "(no harness report)";
}

phase("Judge");
let encoded = json_encode(report_text);
let judge_jobs = [];
let cutout_prompt = "Read XSXB-Frame-Tuner/tools/xsxb_mcp_cutout.js and xsxb_mcp_service.js cutoutAnimation.";
cutout_prompt += " The harness marked xsxb_cutout limited. Read the code, then agree or refute.";
cutout_prompt += " Harness report: " + encoded;
cutout_prompt += " Set agreed=true only if the source still lacks local repair/color protect";
cutout_prompt += " or still cannot start from already-FFmpeg-damaged frames.";
judge_jobs.push(#{
    prompt: cutout_prompt,
    label: "judge-cutout",
    capability_mode: "read-only",
    output_schema: judge_schema,
});

let stub_prompt = "Read XSXB-Frame-Tuner/tools/xsxb_mcp_service.js addAttackTrail, addAttachment, addSfx.";
stub_prompt += " The harness marked those three tools stub. Read the handlers.";
stub_prompt += " Set agreed=true only if they still write hardcoded mcp_test_* data";
stub_prompt += " and ignore real file/stick/audio arguments.";
stub_prompt += " Harness report: " + encoded;
judge_jobs.push(#{
    prompt: stub_prompt,
    label: "judge-stubs",
    capability_mode: "read-only",
    output_schema: judge_schema,
});

let open_prompt = "Read XSXB-Frame-Tuner/tools/xsxb_mcp_service.js openTuner.";
open_prompt += " The harness marked xsxb_open_tuner limited because launched is false.";
open_prompt += " Set agreed=true only if the handler still returns a URL and does not start the server.";
open_prompt += " Harness report: " + encoded;
judge_jobs.push(#{
    prompt: open_prompt,
    label: "judge-open",
    capability_mode: "read-only",
    output_schema: judge_schema,
});

let judges = parallel(judge_jobs);
let agreed = 0;
let judge_count = 0;
for j in judges {
    judge_count += 1;
    if j != () && j.success && j.output != () && j.output.agreed == true {
        agreed += 1;
    }
}
log(agreed.to_string() + "/" + judge_count.to_string() + " gap verdicts confirmed from source");

phase("Report");
let synth_prompt = "Write a short usability conclusion from this harness markdown.";
synth_prompt += " Do not invent extra tools. Keep the table. Add a one-line fully-usable answer:";
synth_prompt += " the catalog is not fully usable until stub/limited tools are product-complete.";
synth_prompt += " Harness: " + encoded;
synth_prompt += " Confirmed gap judges: " + agreed.to_string() + "/" + judge_count.to_string() + ".";
let written = agent(synth_prompt, #{
    label: "report",
    capability_mode: "read-only",
    output_schema: #{
        "type": "object",
        "properties": #{
            "markdown": #{ "type": "string" },
        },
    },
});

let markdown = report_text;
if written != () && written.success && written.output != () && written.output.markdown != () {
    markdown = written.output.markdown;
}
let ready_count = 0;
let limited_count = 0;
let stub_count = 0;
let fail_count = 0;
if ran != () && ran.success && ran.output != () {
    if ran.output.ready != () { ready_count = ran.output.ready; }
    if ran.output.limited != () { limited_count = ran.output.limited; }
    if ran.output.stub != () { stub_count = ran.output.stub; }
    if ran.output.fail != () { fail_count = ran.output.fail; }
}
let report_path = write_scratch_file("xsxb-mcp-usability.md", markdown);
complete(#{
    path: report_path,
    ready: ready_count,
    limited: limited_count,
    stub: stub_count,
    fail: fail_count,
    confirmed_gaps: agreed,
});
