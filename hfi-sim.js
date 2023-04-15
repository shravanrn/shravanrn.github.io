let val_1k = BigInt(1024);
let val_1m = val_1k * val_1k;
let val_1g = val_1k * val_1k * val_1k;
let val_64k = BigInt(64) * val_1k;
let val_4g = BigInt(4) * val_1g;


function isPow2(n) {
    let n_min_1 = n - BigInt(1);
    let masked = n & n_min_1;
    let res = masked == BigInt(0);
    return res;
}

let outputstring = "";

function append_to_output(line) {
    outputstring += line + "\n";
}

function parse_region_info(region_type, parse_is_large, is_data) {
    let regions = [];

    let count = is_data? 4 : 2;

    for (let i = 1; i <= count; i++) {
        let base = document.getElementById(region_type + i + "-base").value;
        let size = document.getElementById(region_type + i + "-size").value;
        let o = {};

        if (!base && !size) { continue; }

        try{
            o.base = BigInt(base);
        } catch {
            append_to_output("Could not parse the base value of explicit data region " + i + ". Please enter a valid address");
            continue;
        }

        try{
            o.size = BigInt(size);
        } catch {
            append_to_output("Could not parse the size value of explicit data region " + i + ". Please enter a valid size");
            continue;
        }

        if (parse_is_large) {
            o.is_large = document.getElementById(region_type + i + "-rtype").value == "Large";
        }

        if (is_data) {
            o.read = document.getElementById(region_type + i + "-read").checked;
            o.write = document.getElementById(region_type + i + "-write").checked;
        } else {
            o.exec = document.getElementById(region_type + i + "-exec").checked;
        }

        o.num = i;

        regions.push(o);
    }

    return regions;
}

function evaluate_hfi_config() {

    let explicit_data_regions = parse_region_info("hfi-explicit-data-region", true /* parse_is_large */, true /* is_data */);

    explicit_data_regions = explicit_data_regions.filter(r => {
        if (r.is_large) {
            if (r.size % val_64k != 0) {
                append_to_output("Explicit data region " + r.num + " is a large region and should have a size which is a multiple of 64KB");
                return false;
            }
        } else {
            if (r.size > val_4g) {
                append_to_output("Explicit data region " + r.num + " is a small region and should have a size which is a smaller than 4GB");
                return false;
            }
        }
        return true;
    });

    let implicit_data_regions = parse_region_info("hfi-implicit-data-region", false /* parse_is_large */, true /* is_data */);

    implicit_data_regions = implicit_data_regions.filter(r => {
        if (!isPow2(r.size)) {
            append_to_output("Implicit data region " + r.num + " should have a size which is a power of 2");
            return false;
        }
        if (r.base % r.size != 0) {
            append_to_output("Implicit data region " + r.num + " should have a base which is a multiple of the size (" + r.size + ")");
            return false;
        }
        return true;
    });

    let implicit_code_regions = parse_region_info("hfi-implicit-code-region", false /* parse_is_large */, false /* is_data */);

    implicit_code_regions = implicit_code_regions.filter(r => {
        if (!isPow2(r.size)) {
            append_to_output("Implicit code region " + r.num + " should have a size which is a power of 2");
            return false;
        }
        if (r.base % r.size != 0) {
            append_to_output("Implicit code region " + r.num + " should have a base which is a multiple of the size (" + r.size + ")");
            return false;
        }
        return true;
    });

    return {
        explicit_data_regions: explicit_data_regions,
        implicit_data_regions: implicit_data_regions,
        implicit_code_regions: implicit_code_regions
    };
}

function parse_mov_operation(is_hmov) {
    let label = is_hmov? "hmov" : "mov";
    let arg = document.getElementById("hfi-" + label + "-arg").value;

    if(!arg) { return; }

    let o = {};

    try{
        o.arg = BigInt(arg);
    } catch {
        append_to_output("Could not parse the argument to the " + label + " operation. Please enter a valid " + (is_hmov? "numeric index into" : "address in") + " the region.");
        return;
    }

    if (is_hmov) {
        o.num = parseInt(document.getElementById("hfi-" + label + "-num").value);
    }
    o.is_write = document.getElementById("hfi-" + label + "-accesstype").value == "write";

    return o;
}

function evaluate_hmov(config) {
    let hmov_op = parse_mov_operation(true /* is_hmov */);
    if(!hmov_op) { return; }

    let hmov_config = null;
    if (config && config.explicit_data_regions) {
        for (let i = 0; i < config.explicit_data_regions.length; i++) {
            const curr = config.explicit_data_regions[i];
            if (curr.num == hmov_op.num) {
                hmov_config = curr;
                break;
            }
        }
    }

    if (!hmov_config) {
        append_to_output("No valid config for explicit data region " + hmov_op.num + ". Could not check hmov operation behavior.");
        return;
    }

    let address = "0x" + (hmov_config.base + hmov_op.arg).toString(16);
    let op_text = hmov_op.is_write? "write" : "read";
    let inrange_text = hmov_op.arg < hmov_config.size? "is in the range of explicit data region " : "is outside the valid range of explicit data region ";
    let perm_check_pass = (hmov_op.is_write && hmov_config.write) || (!hmov_op.is_write && hmov_config.read);
    let perm_check_pass_text = perm_check_pass? "passes" : "does NOT pass";

    append_to_output("hmov" + hmov_config.num + " "+ op_text + " operation at address " +  address + " " + inrange_text + hmov_config.num +
        ". The operation " + perm_check_pass_text + " HFI read/write permission checks.");
}

function evaluate_mov(config) {
    let mov_op = parse_mov_operation(false /* is_hmov */);
    if(!mov_op) { return; }

    let mov_config = null;
    if (config && config.implicit_data_regions) {
        for (let i = 0; i < config.implicit_data_regions.length; i++) {
            const curr = config.implicit_data_regions[i];
            if (mov_op.arg >= curr.base && mov_op.arg < (curr.base + curr.size)) {
                mov_config = curr;
                break;
            }
        }
    }

    let address = "0x" + (mov_op.arg).toString(16);

    if (!mov_config) {
        append_to_output("No implicit data region allows a mov operation at address " + address);
        return;
    }

    let op_text = mov_op.is_write? "write" : "read";
    let perm_check_pass = (mov_op.is_write && mov_config.write) || (!mov_op.is_write && mov_config.read);
    let perm_check_pass_text = perm_check_pass? "passes" : "does NOT pass";

    append_to_output("mov " + op_text + " operation is in implicit data region " + mov_config.num + " at address " +  address +
        ". The operation " + perm_check_pass_text + " HFI read/write permission checks.");
}

function evaluate_exec(config) {

    let arg = document.getElementById("hfi-exec-arg").value;
    if(!arg) { return; }

    let o = {};
    try{
        o.arg = BigInt(arg);
    } catch {
        append_to_output("Could not parse the argument to the exec operation. Please enter a valid address in the region.");
        return;
    }

    let exec_op = o;

    let exec_config = null;
    if (config && config.implicit_code_regions) {
        for (let i = 0; i < config.implicit_code_regions.length; i++) {
            const curr = config.implicit_code_regions[i];
            if (exec_op.arg >= curr.base && exec_op.arg < (curr.base + curr.size)) {
                exec_config = curr;
                break;
            }
        }
    }

    let address = "0x" + (exec_op.arg).toString(16);

    if (!exec_config) {
        append_to_output("No implicit code region allows executing at address " + address);
        return;
    }

    let perm_check_pass = exec_config.exec;
    let perm_check_pass_text = perm_check_pass? "passes" : "does NOT pass";

    append_to_output("Execution is in implicit code region " + exec_config.num + " at address " +  address +
        ". The operation " + perm_check_pass_text + " HFI exec permission checks.");
}


function evaluate_hfi() {
    outputstring = "";
    config = evaluate_hfi_config();

    if (!outputstring) {
        append_to_output("All hfi config checks passed");
    }

    evaluate_hmov(config);
    evaluate_mov(config);
    evaluate_exec(config);

    document.getElementById("hfi-output").textContent = outputstring;
    outputstring = "";
}

function clear_hfi() {
    let inputs = document.getElementsByTagName('input');
    for (i = 0; i < inputs.length; i++) {
        inputs[i].value = "";
        inputs[i].checked = true;
    }

    let selects = document.getElementsByTagName('select');
    for (i = 0; i < selects.length; i++) {
        selects[i].selectedIndex = 0;
    }

}