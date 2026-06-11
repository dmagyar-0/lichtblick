// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import DeleteForeverOutlinedIcon from "@mui/icons-material/DeleteForeverOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import { Button, MenuItem, TextField, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";
import { v4 as uuidv4 } from "uuid";

import { Time, toSec } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@lichtblick/suite-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { downloadTextFile } from "@lichtblick/suite-base/util/download";

import { TaggedEventRow } from "./TaggedEventRow";
import {
  parseAttributeDefinitions,
  parseTaggedEvents,
  positionTaggedEvent,
  serializeTaggedEvents,
} from "./eventUtils";
import { externalEventsApi } from "./externalEventsApi";
import { defaultConfig, useEventTaggingSettings } from "./settings";
import { EventTaggingConfig, TaggedEvent } from "./types";

type Props = {
  config: EventTaggingConfig;
  saveConfig: SaveConfig<EventTaggingConfig>;
};

const useStyles = makeStyles()((theme) => ({
  taggingSection: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1),
    backgroundColor: theme.palette.background.paper,
  },
  attributeField: {
    minWidth: 96,
    flex: "1 1 96px",
  },
  secondsField: {
    width: 96,
  },
  eventList: {
    overflowY: "auto",
  },
}));

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectSetHoveredEvent = (store: TimelineInteractionStateStore) => store.setHoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectSetEventsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setEventsAtHoverValue;
const selectHoverValue = (store: TimelineInteractionStateStore) => store.hoverValue;

function CurrentTimeLabel(): React.JSX.Element {
  const currentTime = useMessagePipeline(selectCurrentTime);
  const { formatTime } = useAppTimeFormat();

  return (
    <Typography variant="caption" color="text.secondary" noWrap>
      {currentTime ? formatTime(currentTime) : "No data source"}
    </Typography>
  );
}

function parseSecondsInput(value: string): number | undefined {
  if (value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function EventTagging(props: Props): React.JSX.Element {
  const { config, saveConfig } = props;
  const { classes } = useStyles();
  const { enqueueSnackbar } = useSnackbar();
  const { formatTime } = useAppTimeFormat();

  const messagePipeline = useMessagePipelineGetter();
  const seek = useMessagePipeline(selectSeek);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);

  const setEvents = useEvents(selectSetEvents);
  const selectedEventId = useEvents(selectSelectedEventId);
  const selectEvent = useEvents(selectSelectEvent);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const setEventsAtHoverValue = useTimelineInteractionState(selectSetEventsAtHoverValue);
  const hoverValue = useTimelineInteractionState(selectHoverValue);

  useEventTaggingSettings(config, saveConfig);

  // Draft state for the "tag at current time" form.
  const [draftAttributes, setDraftAttributes] = useState<Record<string, string>>({});
  const [draftBefore, setDraftBefore] = useState<string>(
    config.defaultBeforeSec > 0 ? String(config.defaultBeforeSec) : "",
  );
  const [draftAfter, setDraftAfter] = useState<string>(
    config.defaultAfterSec > 0 ? String(config.defaultAfterSec) : "",
  );

  // Keep the latest events in a ref so callbacks (external API, async file
  // readers) can append without capturing a stale config.
  const eventsRef = useRef<readonly TaggedEvent[]>(config.events);
  eventsRef.current = config.events;

  const appendEvents = useCallback(
    (newEvents: TaggedEvent[]) => {
      const merged = _.uniqBy([...eventsRef.current, ...newEvents], (event) => event.id);
      saveConfig({
        events: _.sortBy(merged, (event) => toSec(event.timestamp)),
      });
    },
    [saveConfig],
  );

  // Entry point for external services: postMessage / window.lichtblickEventTagging.
  useEffect(() => {
    externalEventsApi.install();
    const unsubscribe = externalEventsApi.subscribe((newEvents) => {
      appendEvents(newEvents);
      enqueueSnackbar(`Received ${newEvents.length} event(s) from external source`, {
        variant: "info",
      });
    });
    const unregister = externalEventsApi.registerEventsProvider(() => [...eventsRef.current]);
    return () => {
      unsubscribe();
      unregister();
    };
  }, [appendEvents, enqueueSnackbar]);

  const sortedEvents = useMemo(
    () => _.sortBy(config.events, (event) => toSec(event.timestamp)),
    [config.events],
  );

  // Project the tagged events onto the timeline and publish them to the events
  // store so the playback bar overlay renders them as ticks. Without an active
  // data source the events are still listed, just not positioned.
  const positionedEvents = useMemo(() => {
    return sortedEvents.map((event) =>
      positionTaggedEvent(event, startTime ?? event.timestamp, endTime ?? event.timestamp),
    );
  }, [sortedEvents, startTime, endTime]);

  useEffect(() => {
    setEvents({ loading: false, value: positionedEvents });
  }, [positionedEvents, setEvents]);

  useEffect(() => {
    return () => {
      setEvents({ loading: false, value: [] });
    };
  }, [setEvents]);

  // Highlight events under the cursor while hovering the playback bar.
  useEffect(() => {
    if (hoverValue?.type !== "PLAYBACK_SECONDS") {
      setEventsAtHoverValue([]);
      return;
    }
    const hoverSec = hoverValue.value;
    const timelineDurationSec =
      startTime && endTime ? toSec(endTime) - toSec(startTime) : undefined;
    setEventsAtHoverValue(
      positionedEvents.filter(
        (event) =>
          timelineDurationSec != undefined &&
          hoverSec >= event.startPosition * timelineDurationSec &&
          hoverSec <= event.endPosition * timelineDurationSec,
      ),
    );
  }, [hoverValue, positionedEvents, setEventsAtHoverValue, startTime, endTime]);

  const onTagEvent = useCallback(() => {
    const {
      playerState: { activeData },
    } = messagePipeline();
    const currentTime: Time | undefined = activeData?.currentTime;
    if (!currentTime) {
      enqueueSnackbar("Cannot tag an event without an active data source", { variant: "warning" });
      return;
    }
    appendEvents([
      {
        id: uuidv4(),
        timestamp: currentTime,
        beforeSec: parseSecondsInput(draftBefore),
        afterSec: parseSecondsInput(draftAfter),
        attributes: { ...draftAttributes },
        createdAt: new Date().toISOString(),
      },
    ]);
  }, [appendEvents, draftAfter, draftAttributes, draftBefore, enqueueSnackbar, messagePipeline]);

  const onChangeAttribute = useCallback(
    (eventId: string, key: string, value: string) => {
      saveConfig({
        events: eventsRef.current.map((event) =>
          event.id === eventId
            ? { ...event, attributes: { ...event.attributes, [key]: value } }
            : event,
        ),
      });
    },
    [saveConfig],
  );

  const onDeleteEvent = useCallback(
    (eventId: string) => {
      if (selectedEventId === eventId) {
        selectEvent(undefined);
      }
      saveConfig({ events: eventsRef.current.filter((event) => event.id !== eventId) });
    },
    [saveConfig, selectEvent, selectedEventId],
  );

  const [confirmingClear, setConfirmingClear] = useState(false);
  const onClearAll = useCallback(() => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    selectEvent(undefined);
    saveConfig({ events: [] });
  }, [confirmingClear, saveConfig, selectEvent]);

  const onExport = useCallback(() => {
    if (eventsRef.current.length === 0) {
      enqueueSnackbar("No events to export", { variant: "warning" });
      return;
    }
    downloadTextFile(serializeTaggedEvents(eventsRef.current), "tagged-events.json");
  }, [enqueueSnackbar]);

  // Hidden file inputs for importing events and the attribute configuration.
  const eventsFileInputRef = useRef<HTMLInputElement>(ReactNull);
  const attributesFileInputRef = useRef<HTMLInputElement>(ReactNull);

  const readJsonFile = useCallback(
    (input: HTMLInputElement, onData: (data: unknown) => void) => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) {
        return;
      }
      file
        .text()
        .then((text) => {
          onData(JSON.parse(text));
        })
        .catch((error: unknown) => {
          enqueueSnackbar(`Failed to read file: ${(error as Error).message}`, {
            variant: "error",
          });
        });
    },
    [enqueueSnackbar],
  );

  const onImportEventsFile = useCallback(
    (input: HTMLInputElement) => {
      readJsonFile(input, (data) => {
        const imported = parseTaggedEvents(data);
        appendEvents(imported);
        enqueueSnackbar(`Imported ${imported.length} event(s)`, { variant: "success" });
      });
    },
    [appendEvents, enqueueSnackbar, readJsonFile],
  );

  const onImportAttributesFile = useCallback(
    (input: HTMLInputElement) => {
      readJsonFile(input, (data) => {
        const attributeDefinitions = parseAttributeDefinitions(data);
        saveConfig({ attributeDefinitions });
        setDraftAttributes({});
        enqueueSnackbar(`Loaded ${attributeDefinitions.length} attribute definition(s)`, {
          variant: "success",
        });
      });
    },
    [enqueueSnackbar, readJsonFile, saveConfig],
  );

  const onClickEvent = useCallback(
    (event: TimelinePositionedEvent) => {
      if (event.event.id === selectedEventId) {
        selectEvent(undefined);
      } else {
        selectEvent(event.event.id);
      }
      if (seek) {
        seek(event.event.startTime);
      }
    },
    [seek, selectEvent, selectedEventId],
  );

  const onHoverStart = useCallback(
    (event: TimelinePositionedEvent) => {
      setHoveredEvent(event);
    },
    [setHoveredEvent],
  );

  const onHoverEnd = useCallback(() => {
    setHoveredEvent(undefined);
  }, [setHoveredEvent]);

  return (
    <Stack fullHeight>
      <PanelToolbar />
      <Stack flex="auto" gap={1} padding={1} overflow="hidden">
        <div className={classes.taggingSection}>
          <Stack gap={1}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
              <Typography variant="subtitle2">Tag at current time</Typography>
              <CurrentTimeLabel />
            </Stack>
            <Stack direction="row" gap={1} flexWrap="wrap">
              {config.attributeDefinitions.map((definition) => (
                <TextField
                  key={definition.key}
                  className={classes.attributeField}
                  select
                  size="small"
                  variant="filled"
                  label={definition.label ?? definition.key}
                  value={draftAttributes[definition.key] ?? ""}
                  onChange={(changeEvent) => {
                    setDraftAttributes((draft) => ({
                      ...draft,
                      [definition.key]: changeEvent.target.value,
                    }));
                  }}
                >
                  {definition.options.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              ))}
            </Stack>
            <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
              <TextField
                className={classes.secondsField}
                size="small"
                variant="filled"
                label="Before (s)"
                type="number"
                inputProps={{ min: 0, step: "any" }}
                value={draftBefore}
                onChange={(changeEvent) => {
                  setDraftBefore(changeEvent.target.value);
                }}
              />
              <TextField
                className={classes.secondsField}
                size="small"
                variant="filled"
                label="After (s)"
                type="number"
                inputProps={{ min: 0, step: "any" }}
                value={draftAfter}
                onChange={(changeEvent) => {
                  setDraftAfter(changeEvent.target.value);
                }}
              />
              <Stack flexGrow={1} />
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                disabled={!startTime}
                onClick={onTagEvent}
              >
                Tag event
              </Button>
            </Stack>
          </Stack>
        </div>

        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button
            size="small"
            color="inherit"
            startIcon={<FileUploadOutlinedIcon />}
            onClick={() => eventsFileInputRef.current?.click()}
          >
            Import
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<FileDownloadOutlinedIcon />}
            onClick={onExport}
          >
            Export
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<TuneIcon />}
            onClick={() => attributesFileInputRef.current?.click()}
          >
            Attribute config
          </Button>
          <Stack flexGrow={1} />
          <Button
            size="small"
            color={confirmingClear ? "error" : "inherit"}
            startIcon={<DeleteForeverOutlinedIcon />}
            disabled={config.events.length === 0}
            onClick={onClearAll}
            onBlur={() => {
              setConfirmingClear(false);
            }}
          >
            {confirmingClear ? "Confirm clear" : "Clear all"}
          </Button>
        </Stack>

        <input
          ref={eventsFileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(changeEvent) => {
            onImportEventsFile(changeEvent.currentTarget);
          }}
        />
        <input
          ref={attributesFileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(changeEvent) => {
            onImportAttributesFile(changeEvent.currentTarget);
          }}
        />

        {sortedEvents.length === 0 ? (
          <Stack flex="auto" alignItems="center" justifyContent="center" padding={2}>
            <Typography align="center" color="text.secondary">
              No tagged events
            </Typography>
          </Stack>
        ) : (
          <Stack className={classes.eventList} flex="auto" gap={1}>
            {sortedEvents.map((event, index) => {
              const positionedEvent = positionedEvents[index];
              if (!positionedEvent) {
                return ReactNull;
              }
              return (
                <TaggedEventRow
                  key={event.id}
                  event={event}
                  positionedEvent={positionedEvent}
                  formattedTime={formatTime(event.timestamp)}
                  isHovered={
                    hoveredEvent
                      ? event.id === hoveredEvent.event.id
                      : eventsAtHoverValue[event.id] != undefined
                  }
                  isSelected={event.id === selectedEventId}
                  attributeDefinitions={config.attributeDefinitions}
                  onClick={onClickEvent}
                  onHoverStart={onHoverStart}
                  onHoverEnd={onHoverEnd}
                  onChangeAttribute={onChangeAttribute}
                  onDelete={onDeleteEvent}
                />
              );
            })}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

export default Panel(
  Object.assign(React.memo(EventTagging), {
    panelType: "EventTagging",
    defaultConfig,
  }),
);
