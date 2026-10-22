import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'data', 'writing-pipeline.json');

function readData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeData(data: unknown) {
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

export async function GET() {
  try {
    const data = readData();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ items: [], streakDays: [] }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const current = readData();

    if (body.items) {
      current.items = body.items;
    }
    if (body.streakDays) {
      current.streakDays = body.streakDays;
    }

    writeData(current);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Writing pipeline update error:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
