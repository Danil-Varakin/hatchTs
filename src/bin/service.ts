#!/usr/bin/env node
// The service: JSON lines on stdin and stdout (PROTOCOL.md).
import { serve } from '../service/index.ts';

await serve();
