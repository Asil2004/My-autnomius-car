package uz.iiv.faceid.recognition

import android.graphics.Rect
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.security.LivenessResult

data class RecognitionResult(
    val matchedPerson: FaceEntity?,
    val similarity: Float,
    val distance: Float,
    val isUnknown: Boolean,
    val livenessResult: LivenessResult?,
    val boundingBox: Rect
)
