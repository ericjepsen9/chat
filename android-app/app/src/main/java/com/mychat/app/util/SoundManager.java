package com.mychat.app.util;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import com.mychat.app.R;

/**
 * Manages in-app notification sounds and vibration feedback.
 * Uses SoundPool for low-latency playback when the app is in the foreground.
 *
 * Three notification types with distinct sound + vibration:
 * - MESSAGE:     short double-beep + light double-tap vibration
 * - CALL:        ringtone tone (for in-app call alerts; full-screen uses MediaPlayer)
 * - TRANSACTION: rising coin-like sound + triple-tap vibration
 */
public class SoundManager {

    private static final String TAG = "SoundManager";

    public enum NotificationType {
        MESSAGE,
        CALL,
        TRANSACTION
    }

    private static SoundManager instance;
    private SoundPool soundPool;
    private int soundIdMessage;
    private int soundIdCall;
    private int soundIdTransaction;
    private boolean loaded = false;

    // Vibration patterns (ms): delay, on, off, on, ...
    private static final long[] VIBRATE_MESSAGE     = {0, 100, 80, 100};
    private static final long[] VIBRATE_CALL        = {0, 800, 400, 800, 400, 800, 1200};
    private static final long[] VIBRATE_TRANSACTION = {0, 150, 100, 150, 100, 300};

    private SoundManager() {}

    public static synchronized SoundManager getInstance() {
        if (instance == null) {
            instance = new SoundManager();
        }
        return instance;
    }

    /**
     * Initialize the SoundPool and load all notification sounds.
     * Call once in Application.onCreate() or MainActivity.onCreate().
     */
    public void init(Context context) {
        if (soundPool != null) return;

        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        soundPool = new SoundPool.Builder()
                .setMaxStreams(3)
                .setAudioAttributes(attrs)
                .build();

        soundPool.setOnLoadCompleteListener((pool, sampleId, status) -> {
            if (status == 0) {
                loaded = true;
            }
        });

        soundIdMessage = soundPool.load(context, R.raw.sound_message, 1);
        soundIdCall = soundPool.load(context, R.raw.sound_call_ringtone, 1);
        soundIdTransaction = soundPool.load(context, R.raw.sound_transaction, 1);
    }

    /**
     * Play the notification sound and vibration for the given type.
     */
    public void play(Context context, NotificationType type) {
        playSound(type);
        vibrate(context, type);
    }

    /**
     * Play only the sound (no vibration).
     */
    public void playSound(NotificationType type) {
        if (soundPool == null || !loaded) return;

        int soundId;
        switch (type) {
            case CALL:
                soundId = soundIdCall;
                break;
            case TRANSACTION:
                soundId = soundIdTransaction;
                break;
            case MESSAGE:
            default:
                soundId = soundIdMessage;
                break;
        }
        soundPool.play(soundId, 1.0f, 1.0f, 1, 0, 1.0f);
    }

    /**
     * Trigger vibration pattern for the given notification type.
     */
    public void vibrate(Context context, NotificationType type) {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;

        long[] pattern;
        switch (type) {
            case CALL:
                pattern = VIBRATE_CALL;
                break;
            case TRANSACTION:
                pattern = VIBRATE_TRANSACTION;
                break;
            case MESSAGE:
            default:
                pattern = VIBRATE_MESSAGE;
                break;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
        } else {
            vibrator.vibrate(pattern, -1);
        }
    }

    /**
     * Release resources. Call when app is being destroyed.
     */
    public void release() {
        if (soundPool != null) {
            soundPool.release();
            soundPool = null;
            loaded = false;
        }
    }
}
