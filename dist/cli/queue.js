import fs from 'fs';
import os from 'os';
import path from 'path';
import { AutoMemClient } from '../automem-client.js';
function parseQueueArgs(args) {
    const options = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '--file':
            case '-f':
                options.filePath = args[i + 1];
                i += 1;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--limit':
                options.limit = Number.parseInt(args[i + 1] ?? '', 10) || undefined;
                i += 1;
                break;
            default:
                break;
        }
    }
    return options;
}
function normalizeTags(tags) {
    if (!tags)
        return [];
    if (Array.isArray(tags))
        return tags.map((tag) => `${tag}`.trim()).filter(Boolean);
    if (typeof tags === 'string') {
        return tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
    }
    return [];
}
function ensureObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...value };
    }
    return {};
}
export async function runQueueCommand(args = []) {
    const options = parseQueueArgs(args);
    const queuePath = path.resolve(options.filePath ?? path.join(os.homedir(), '.claude', 'scripts', 'memory-queue.jsonl'));
    if (!fs.existsSync(queuePath)) {
        console.log(`Queue file not found at ${queuePath}. Nothing to do.`);
        return;
    }
    const lines = fs
        .readFileSync(queuePath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        console.log('Memory queue empty.');
        return;
    }
    const client = new AutoMemClient({
        endpoint: process.env.AUTOMEM_ENDPOINT ?? 'http://127.0.0.1:8001',
        apiKey: process.env.AUTOMEM_API_KEY ?? undefined,
    });
    const remaining = [];
    const associations = [];
    let storedCount = 0;
    let skippedCount = 0;
    for (const line of lines.slice(0, options.limit ?? lines.length)) {
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch (error) {
            console.warn('Skipping invalid queue entry:', error);
            skippedCount += 1;
            continue;
        }
        const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
        if (!content) {
            console.warn('Skipping queue entry without content');
            skippedCount += 1;
            continue;
        }
        const record = {
            content,
            tags: normalizeTags(parsed.tags ?? parsed.metadata?.tags),
            importance: typeof parsed.importance === 'number' ? parsed.importance : undefined,
            metadata: ensureObject(parsed.metadata),
            timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
            embedding: Array.isArray(parsed.embedding) ? parsed.embedding : undefined,
        };
        if (parsed.type && !record.metadata?.type) {
            record.metadata.type = parsed.type;
        }
        if (options.dryRun) {
            console.log(`[dry-run] would store memory: ${record.content.slice(0, 80)}...`);
            storedCount += 1;
            continue;
        }
        try {
            const result = await client.storeMemory(record);
            console.log(`Stored memory ${result.memory_id ?? ''}`);
            storedCount += 1;
            if (parsed.relatesTo) {
                associations.push({
                    source: parsed.relatesTo,
                    target: result.memory_id ?? '',
                    type: parsed.relationshipType,
                    strength: parsed.relationshipStrength,
                });
            }
        }
        catch (error) {
            console.error('Failed to store memory:', error.message);
            remaining.push(line);
        }
    }
    // Append untouched lines (when limit smaller than queue)
    if ((options.limit ?? lines.length) < lines.length) {
        remaining.push(...lines.slice(options.limit ?? lines.length));
    }
    if (!options.dryRun) {
        for (const relation of associations) {
            if (!relation.source || !relation.target)
                continue;
            try {
                const relationType = (relation.type ?? 'RELATES_TO').toString().toUpperCase();
                await client.associateMemories({
                    memory1_id: relation.source,
                    memory2_id: relation.target,
                    type: relationType,
                    strength: relation.strength ?? 0.5,
                });
            }
            catch (error) {
                console.warn('Failed to create relationship:', error.message);
            }
        }
    }
    if (!options.dryRun) {
        if (remaining.length === 0) {
            fs.unlinkSync(queuePath);
        }
        else {
            fs.writeFileSync(`${queuePath}`, `${remaining.join('\n')}\n`, 'utf8');
        }
    }
    console.log(`Queue processing complete. Stored: ${storedCount}, skipped: ${skippedCount}, remaining: ${remaining.length}`);
}
//# sourceMappingURL=queue.js.map