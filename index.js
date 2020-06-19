const { spawn } = require("child_process");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { writeFileSync } = require("fs");
const { hid_map } = require("./hid_map");
const chalk = require("chalk");

const COMMAND_PREFIX = ";;";
const COMMANDS = {
  help: () => {
    console.log("This is the help info");
  },
  macro: () => {
    console.log("Please a key to record a macro for it...");
    isRecording = -1;
  },
  hello_world: () => {
    console.log("Hi Eric!");
  },
};

//https://en.wikipedia.org/wiki/Modifier_key
const modifiers = {
  SHIFT: {
    names: ["Shift_R", "Shift_L"],
    mask: [1 << 5, 1 << 1],
    active: 0,
  },
  CTRL: {
    names: ["Control_R", "Control_L"],
    mask: [1 << 4, 1 << 0],
    active: 0,
  },
};

let human_readable_history = [];
const max_human_readable_history_length =
  Math.max(...Object.keys(COMMANDS).map((cmd) => cmd.length)) +
  COMMAND_PREFIX.length;

let recording_history = [];

function setModifier(name, value) {
  for (modifierName in modifiers) {
    const modifier = modifiers[modifierName];
    const nameIndex = modifier.names.indexOf(name);
    if (nameIndex >= 0) {
      if (value) {
        modifier.active += modifier.mask[nameIndex];
      } else {
        modifier.active -= modifier.mask[nameIndex];
      }
      return true;
    }
  }
}

function getModifierMask() {
  return Object.keys(modifiers).reduce(
    (sum, key) => sum + modifiers[key].active,
    0
  );
}

function send_key(key) {
  const mod = getModifierMask();
  const packet = [
    `\\${mod || 0}`,
    `\\0`,
    `\\x${key || 0}`,
    `\\0`,
    `\\0`,
    `\\0`,
    `\\0`,
    `\\0`,
  ];
  console.log(packet.join(" "));
  return packet.join("");
}

let isRecording = 0;
function onLiteralKeyEvent(keyboard_map, key_bundle) {
  switch (key_bundle.action) {
    case "press":
      if (key_bundle.name === "Escape") {
        isRecording = false;
        console.log(
          recording_history.reduce((arr, bundle) => {
            arr.push(bundle.name);
            return arr;
          }, [])
        );
        console.log("Macro recording complete!");
        recording_history = [];
      }

      if (!setModifier(key_bundle.name, true)) {
        const mapping = keyboard_map[key_bundle.code];
        human_readable_history.push(
          modifiers.SHIFT.active ? mapping.shift : mapping.default
        );
      }

      const mapping = keyboard_map[key_bundle.code];
      const char = mapping.default;

      if (isRecording === -1) {
        const key = toUTF8([char]);

        if (!hid_map[key]) {
          console.log("Please press a non-modifier key...");
        } else {
          console.log(`Recording macro for key "${key}"...`);
          isRecording = char;
        }
      } else if (isRecording) {
        recording_history.push(key_bundle);
        // const key = (hid_map[toUTF8([char])] || [])[0];
        // send_key(key);
      }

      const input = toUTF8(human_readable_history);

      for (commandName of Object.keys(COMMANDS)) {
        if (input.endsWith(COMMAND_PREFIX + commandName)) {
          COMMANDS[commandName]();
          break;
        }
      }
      break;
    case "release":
      setModifier(key_bundle.name, false);
  }

  human_readable_history = human_readable_history.slice(
    -max_human_readable_history_length
  );
}

function toUTF8(arr) {
  return Buffer.from(arr).toString("utf8");
}

(async () => {
  writeFileSync(
    "/tmp/xinput_capture",
    `#!/usr/bin/env bash
xinput list |
  grep -Po 'id=\\K\\d+(?=.*slave\\s*keyboard)' |
  xargs -P0 -n1 xinput test |
  awk 'BEGIN{while (("xmodmap -pke" | getline) > 0) k[$2]=$4}
     {print $0 k[$NF]; fflush("/dev/stdout")}'`
  );

  //http://wiki.linuxquestions.org/wiki/List_of_Keysyms_Recognised_by_Xmodmap
  // https://www.cl.cam.ac.uk/~mgk25/ucs/keysymdef.h
  const keyboard_map = (await exec("xmodmap -pk")).stdout
    .split("\n")
    .map((row) => row.split(/[\W]/).filter((c) => c))
    .reduce((map, row) => {
      row = [...row, "", "", "", "", "", "", ""];
      map[row[0]] = { default: row[1], shift: row[3] };
      return map;
    }, {});

  console.log(
    `${chalk.green("✓")} Loaded ${Object.keys(keyboard_map).length} key map`
  );

  const xinput_capture = spawn("bash", ["/tmp/xinput_capture"]);

  xinput_capture.stdout.on("data", (data) =>
    data
      .toString()
      .trim()
      .split(/\W/)
      .filter((d) => d && d !== "key")
      .join(",")
      .match(/([^,]+,[^,]+,[^,]+),?/g)
      .map((match) => {
        const [action, code, name] = match.split(",");
        return { action, code, name };
      })
      .forEach(onLiteralKeyEvent.bind(null, keyboard_map))
  );

  console.log(`${chalk.green("✓")} Listening for keystrokes...`);
})();
