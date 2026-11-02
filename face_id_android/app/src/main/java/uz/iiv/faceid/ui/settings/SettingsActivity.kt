package uz.iiv.faceid.ui.settings

import android.os.Bundle
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import uz.iiv.faceid.FaceIdApp
import uz.iiv.faceid.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private val settings = FaceIdApp.instance.settings

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadCurrentSettings()
        setupListeners()
    }

    private fun loadCurrentSettings() {
        val currentThresh = (settings.threshold * 100).toInt()
        binding.sbThreshold.progress = currentThresh
        binding.tvThresholdValue.text = "Joriy chegara: ${settings.threshold} ($currentThresh%)"

        binding.switchLiveness.isChecked = settings.isLivenessEnabled

        when (settings.throttleIntervalMs) {
            100L -> binding.rbThrottle100.isChecked = true
            400L -> binding.rbThrottle400.isChecked = true
            else -> binding.rbThrottle200.isChecked = true
        }
    }

    private fun setupListeners() {
        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.sbThreshold.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                val clamped = progress.coerceIn(30, 95)
                val floatVal = clamped / 100.0f
                binding.tvThresholdValue.text = "Joriy chegara: $floatVal ($clamped%)"
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        binding.btnSaveSettings.setOnClickListener {
            saveSettings()
        }
    }

    private fun saveSettings() {
        val newThresh = binding.sbThreshold.progress.coerceIn(30, 95) / 100.0f
        settings.threshold = newThresh
        settings.isLivenessEnabled = binding.switchLiveness.isChecked

        val newThrottle = when {
            binding.rbThrottle100.isChecked -> 100L
            binding.rbThrottle400.isChecked -> 400L
            else -> 200L
        }
        settings.throttleIntervalMs = newThrottle

        Toast.makeText(this, "Sozlamalar muvaffaqiyatli saqlandi!", Toast.LENGTH_SHORT).show()
        finish()
    }
}
