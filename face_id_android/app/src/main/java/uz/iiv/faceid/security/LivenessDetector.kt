package uz.iiv.faceid.security

import com.google.mlkit.vision.face.Face
import kotlin.math.abs
import kotlin.math.max

data class LivenessResult(
    val isLive: Boolean,
    val reason: String,
    val blinkDetected: Boolean,
    val poseMovementDetected: Boolean
)

class LivenessDetector {

    private var previousLeftEyeOpen: Float? = null
    private var previousRightEyeOpen: Float? = null
    private var eyeClosedRecorded = false
    private var blinkConfirmed = false

    private var initialYaw: Float? = null
    private var initialPitch: Float? = null
    private var maxAngleDelta = 0.0f

    private var consecutiveFramesLive = 0

    fun reset() {
        previousLeftEyeOpen = null
        previousRightEyeOpen = null
        eyeClosedRecorded = false
        blinkConfirmed = false
        initialYaw = null
        initialPitch = null
        maxAngleDelta = 0.0f
        consecutiveFramesLive = 0
    }

    /**
     * Analyzes face landmarks and probabilities over consecutive frames.
     */
    fun evaluate(face: Face): LivenessResult {
        val leftEye = face.leftEyeOpenProbability ?: -1.0f
        val rightEye = face.rightEyeOpenProbability ?: -1.0f
        val yaw = face.headEulerAngleY
        val pitch = face.headEulerAngleX

        // 1. Head Pose Micro-motion
        if (initialYaw == null || initialPitch == null) {
            initialYaw = yaw
            initialPitch = pitch
        } else {
            val deltaY = abs(yaw - (initialYaw ?: yaw))
            val deltaX = abs(pitch - (initialPitch ?: pitch))
            val currentDelta = max(deltaY, deltaX)
            if (currentDelta > maxAngleDelta) {
                maxAngleDelta = currentDelta
            }
        }
        val posePassed = maxAngleDelta >= 2.5f

        // 2. Eye Blink Tracking
        if (leftEye >= 0.0f && rightEye >= 0.0f) {
            val avgEyeOpen = (leftEye + rightEye) / 2.0f
            if (avgEyeOpen < 0.25f) {
                eyeClosedRecorded = true
            } else if (eyeClosedRecorded && avgEyeOpen > 0.65f) {
                blinkConfirmed = true
            }
        }

        // Real person check: either confirmed blink OR natural 3D head movement
        val isLive = blinkConfirmed || posePassed

        val reason = when {
            blinkConfirmed -> "Jonli ko'z pirpirashi tasdiqlandi"
            posePassed -> "Bosh harakati mikrodinamikasi tasdiqlandi"
            else -> "Statik tasvir (pirpiring yoki boshni biroz qimirlating)"
        }

        return LivenessResult(
            isLive = isLive,
            reason = reason,
            blinkDetected = blinkConfirmed,
            poseMovementDetected = posePassed
        )
    }
}
