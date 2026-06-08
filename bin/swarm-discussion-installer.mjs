#!/usr/bin/env node
import { main } from "../lib/installer.mjs";

process.exitCode = main(process.argv.slice(2), process);
