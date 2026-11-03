package uz.iiv.faceid.camera

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import androidx.camera.core.CameraSelector
import uz.iiv.faceid.recognition.RecognitionResult
import kotlin.math.max

class CameraOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val results = mutableListOf<RecognitionResult>()
    private var imageWidth = 0
    private var imageHeight = 0
    private var lensFacing = CameraSelector.LENS_FACING_FRONT

    private val boxPaintPass = Paint().apply {
        color = Color.parseColor("#00FF88")
        style = Paint.Style.STROKE
        strokeWidth = 5.0f
        isAntiAlias = true
    }

    private val boxPaintUnknown = Paint().apply {
        color = Color.parseColor("#FFB800")
        style = Paint.Style.STROKE
        strokeWidth = 4.0f
        isAntiAlias = true
    }

    private val boxPaintSpoof = Paint().apply {
        color = Color.parseColor("#FF3366")
        style = Paint.Style.STROKE
        strokeWidth = 5.0f
        isAntiAlias = true
    }

    private val headerBgPaint = Paint().apply {
        style = Paint.Style.FILL
        isAntiAlias = true
    }

    private val textPaint = Paint().apply {
        color = Color.parseColor("#080E14")
        textSize = 34.0f
        isFakeBoldText = true
        isAntiAlias = true
    }

    private val subTextPaint = Paint().apply {
        color = Color.parseColor("#080E14")
        textSize = 24.0f
        isAntiAlias = true
    }

    @Synchronized
    fun setResults(
        newResults: List<RecognitionResult>,
        imgWidth: Int,
        imgHeight: Int,
        facing: Int
    ) {
        results.clear()
        results.addAll(newResults)
        imageWidth = imgWidth
        imageHeight = imgHeight
        lensFacing = facing
        postInvalidate()
    }

    @Synchronized
    fun clear() {
        results.clear()
        postInvalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (imageWidth == 0 || imageHeight == 0 || results.isEmpty()) return

        val viewWidth = width.toFloat()
        val viewHeight = height.toFloat()

        // Calculate aspect fill scale
        val scaleX = viewWidth / imageWidth.toFloat()
        val scaleY = viewHeight / imageHeight.toFloat()
        val scale = max(scaleX, scaleY)

        val offsetX = (viewWidth - imageWidth * scale) / 2.0f
        val offsetY = (viewHeight - imageHeight * scale) / 2.0f

        for (res in results) {
            val rawBox = res.boundingBox

            // Map and flip for front camera mirror
            val left = if (lensFacing == CameraSelector.LENS_FACING_FRONT) {
                viewWidth - (rawBox.right * scale + offsetX)
            } else {
                rawBox.left * scale + offsetX
            }

            val right = if (lensFacing == CameraSelector.LENS_FACING_FRONT) {
                viewWidth - (rawBox.left * scale + offsetX)
            } else {
                rawBox.right * scale + offsetX
            }

            val top = rawBox.top * scale + offsetY
            val bottom = rawBox.bottom * scale + offsetY

            val rectF = RectF(left, top, right, bottom)

            val isSpoof = res.livenessResult != null && !res.livenessResult.isLive
            val isKnown = !res.isUnknown && !isSpoof

            val activePaint = when {
                isSpoof -> boxPaintSpoof
                isKnown -> boxPaintPass
                else -> boxPaintUnknown
            }

            // Draw tactical corner brackets
            val cornerLen = (rectF.width() * 0.18f).coerceIn(20f, 60f)
            canvas.drawRoundRect(rectF, 12f, 12f, activePaint)

            // Draw Header Badge
            val headerHeight = 54.0f
            val headerRect = RectF(rectF.left, rectF.top - headerHeight, rectF.right, rectF.top)
            headerBgPaint.color = activePaint.color
            canvas.drawRoundRect(headerRect, 8f, 8f, headerBgPaint)

            val displayName = when {
                isSpoof -> "⚠️ SOXTA / FOTO"
                isKnown -> res.matchedPerson?.fullName ?: "NOMA'LUM"
                else -> "NOMA'LUM SHAXS (PIYODA)"
            }

            val simPercent = (res.similarity * 100).toInt()
            val textToDraw = "$displayName ($simPercent%)"
            canvas.drawText(textToDraw, rectF.left + 12f, rectF.top - 16f, textPaint)

            // Role / Subtitle tag below
            if (isKnown && res.matchedPerson?.role != null) {
                val roleTag = "🛡️ ${res.matchedPerson.role}"
                val bottomTagRect = RectF(rectF.left, rectF.bottom, rectF.left + 220f, rectF.bottom + 36f)
                headerBgPaint.color = Color.parseColor("#E6080E14")
                canvas.drawRoundRect(bottomTagRect, 6f, 6f, headerBgPaint)
                subTextPaint.color = activePaint.color
                canvas.drawText(roleTag, rectF.left + 10f, rectF.bottom + 26f, subTextPaint)
            }
        }
    }
}
